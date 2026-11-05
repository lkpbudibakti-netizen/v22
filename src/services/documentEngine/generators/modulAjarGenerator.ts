import { formatClassLabel } from '../../academicScope';
import { MODUL_AJAR_RENDERER_VERSION } from '../../../config/modulAjarRendererVersion';
export { MODUL_AJAR_RENDERER_VERSION };
import { recordModulAjarExportDiagnostic } from '../modulAjarExportDiagnostics';
import { createDocumentSnapshot } from '../snapshot';
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
  HeadingLevel,
  BorderStyle,
  ShadingType,
} from 'docx';
import saveAs from 'file-saver';
import { DocumentGenerationContext, GeneratedDocumentResult } from '../types';
import { formatOfficialDate, DOCX_BG_TABLE_HEADER } from '../docxStyles';
import { AssessmentCriterion, KKTPLevel, LearningPlan, SchoolData, TeacherProfile } from '../../../types';
import { createEmptyLearningPlan } from '../../learningPlanService';
import { getCurriculumTypeFromSetting, isMerdeka } from '../../curriculumRouter';
import { buildModulAjarProjection, ModulAjarMeeting } from '../modulAjarProjection';

/**
 * Creates professional standard Modul Ajar identity metadata table in Times New Roman.
 * Strictly excludes AI indicators, internal status/sourceType, and student count.
 */
function createModulAjarIdentityTable(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: rows.map(
      ([label, val]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 30, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  spacing: { line: 276, after: 60 },
                  children: [new TextRun({ text: label, bold: true, size: 24, font: 'Times New Roman' })],
                }),
              ],
            }),
            new TableCell({
              width: { size: 70, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  spacing: { line: 276, after: 60 },
                  children: [new TextRun({ text: val, size: 24, font: 'Times New Roman' })],
                }),
              ],
            }),
          ],
        })
    ),
  });
}

function createModulAjarSignoffBlock(
  school: SchoolData,
  profile: TeacherProfile,
  isBlankMode: boolean = false,
  customDate?: string
): (Paragraph | Table)[] {
  const dateStr = formatOfficialDate(school, customDate);
  const principalTitle = 'Kepala Sekolah';
  const teacherTitle = 'Guru Mata Pelajaran';

  const principalNameText = isBlankMode
    ? '(........................)'
    : school.principalName
    ? school.principalName
    : '(........................)';

  const principalNipText = isBlankMode
    ? 'NIP. ....................'
    : school.principalNip
    ? `NIP. ${school.principalNip}`
    : 'NIP. ....................';

  const teacherNameText = isBlankMode
    ? '(........................)'
    : profile.name
    ? profile.name
    : '(........................)';

  const teacherNipText = isBlankMode
    ? 'NIP. ....................'
    : profile.nip
    ? `NIP. ${profile.nip}`
    : 'NIP. ....................';

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'Mengetahui,', size: 24, font: 'Times New Roman' })],
              }),
              new Paragraph({
                children: [new TextRun({ text: principalTitle, size: 24, font: 'Times New Roman' })],
              }),
              new Paragraph({ spacing: { after: 720 } }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: principalNameText,
                    bold: !isBlankMode && !!school.principalName,
                    size: 24,
                    font: 'Times New Roman',
                    underline: !isBlankMode && school.principalName ? {} : undefined,
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: principalNipText,
                    size: 24,
                    font: 'Times New Roman',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              isBlankMode
                ? new Paragraph({ children: [] })
                : new Paragraph({
                    children: [new TextRun({ text: dateStr, size: 24, font: 'Times New Roman' })],
                  }),
              new Paragraph({
                children: [new TextRun({ text: teacherTitle, size: 24, font: 'Times New Roman' })],
              }),
              new Paragraph({ spacing: { after: 720 } }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: teacherNameText,
                    bold: !isBlankMode && !!profile.name,
                    size: 24,
                    font: 'Times New Roman',
                    underline: !isBlankMode && profile.name ? {} : undefined,
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: teacherNipText,
                    size: 24,
                    font: 'Times New Roman',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  return [new Paragraph({ spacing: { before: 240, after: 120 } }), table];
}

/**
 * Removes undefined/null or expressions like "opening: undefined" to guarantee clean output.
 */
function cleanText(val: unknown): string {
  if (val === undefined || val === null) return '';
  const s = String(val).trim();
  if (s === 'undefined' || s === 'null') return '';
  return s.replace(/\b(opening|core|closing):\s*undefined\b/gi, '').trim();
}

/**
 * Safely extracts criterion level description for standardized rubric tiers.
 */
function getLevelDesc(levels: KKTPLevel[] = [], target: string): string {
  const norm = target.toLowerCase().trim();
  const exact = levels.find((l) => {
    const lvl = (l.level || '').toLowerCase().trim();
    const lbl = (l.label || '').toLowerCase().trim();
    return lvl === norm || lbl === norm;
  });
  if (exact) {
    const desc = cleanText(exact.description || exact.label || exact.level);
    return desc || '-';
  }

  const found = levels.find((l) => {
    const lvl = (l.level || '').toLowerCase().trim();
    const lbl = (l.label || '').toLowerCase().trim();
    if (norm === 'baik' && (lvl.includes('sangat') || lbl.includes('sangat'))) {
      return false;
    }
    return lvl.includes(norm) || lbl.includes(norm);
  });
  if (found) {
    const desc = cleanText(found.description || found.label || found.level);
    return desc || '-';
  }

  return '-';
}

/**
 * Creates structured meeting block table:
 * - Header: PERTEMUAN N — Judul — X JP with light shading (DOCX_BG_TABLE_HEADER)
 * - keepNext on header paragraph to prevent orphan headers
 * - Strict omission of meeting date
 * - Bold labels: Materi, Tujuan Pembelajaran, Kegiatan Pembelajaran, Asesmen, KKTP
 * - Compact KKTP per TP; full rubric levels stay in the unit assessment section
 */
function createModulAjarMeetingTable(
  meeting: ModulAjarMeeting
): Table {
  const tableBorder = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const cellMargin = { top: 100, bottom: 100, left: 140, right: 140 };

  const meetingTitle = cleanText(meeting.title) || `Pertemuan ${meeting.order}`;
  const headerTitle = `PERTEMUAN ${meeting.order} — ${meetingTitle} — ${meeting.jp} JP — ${meeting.durationMinutes} Menit`;

  const headerRow = new TableRow({
    cantSplit: true,
    children: [
      new TableCell({
        columnSpan: 2,
        shading: { type: ShadingType.CLEAR, fill: DOCX_BG_TABLE_HEADER },
        margins: { top: 120, bottom: 120, left: 140, right: 140 },
        children: [
          new Paragraph({
            keepNext: true,
            spacing: { line: 276, before: 60, after: 60 },
            children: [
              new TextRun({
                text: headerTitle,
                bold: true,
                size: 22,
                font: 'Times New Roman',
                color: '000000',
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const createLabelCell = (label: string): TableCell => {
    return new TableCell({
      width: { size: 25, type: WidthType.PERCENTAGE },
      margins: cellMargin,
      children: [
        new Paragraph({
          spacing: { line: 276, after: 40 },
          children: [
            new TextRun({
              text: label,
              bold: true,
              size: 22,
              font: 'Times New Roman',
              color: '000000',
            }),
          ],
        }),
      ],
    });
  };

  // 1. Materi
  const materiParagraphs: Paragraph[] = [];
  if (meeting.materials && meeting.materials.length > 0) {
    meeting.materials.forEach((mat) => {
      const matTitle = cleanText(mat.title);
      if (matTitle) {
        materiParagraphs.push(
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { line: 276, after: 40 },
            children: [
              new TextRun({
                text: `• ${matTitle}`,
                size: 22,
                font: 'Times New Roman',
              }),
            ],
          })
        );
      }
    });
  }
  if (materiParagraphs.length === 0) {
    materiParagraphs.push(
      new Paragraph({
        spacing: { line: 276, after: 40 },
        children: [new TextRun({ text: '-', size: 22, font: 'Times New Roman' })],
      })
    );
  }

  const materiRow = new TableRow({
    cantSplit: true,
    children: [
      createLabelCell('Materi'),
      new TableCell({
        width: { size: 75, type: WidthType.PERCENTAGE },
        margins: cellMargin,
        children: materiParagraphs,
      }),
    ],
  });

  // 2. Tujuan Pembelajaran
  const tpParagraphs: Paragraph[] = [];
  if (meeting.resolvedTPs && meeting.resolvedTPs.length > 0) {
    meeting.resolvedTPs.forEach((t) => {
      const stmt = cleanText(t.statement);
      if (stmt) {
        tpParagraphs.push(
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { line: 276, after: 40 },
            children: [
              new TextRun({
                text: `• ${t.code ? `[${t.code}] ` : ''}${stmt}${t.materialScope ? ` (Materi: ${cleanText(t.materialScope)})` : ''}`,
                size: 22,
                font: 'Times New Roman',
              }),
            ],
          })
        );
      }
    });
  }
  if (tpParagraphs.length === 0) {
    tpParagraphs.push(
      new Paragraph({
        spacing: { line: 276, after: 40 },
        children: [new TextRun({ text: '-', size: 22, font: 'Times New Roman' })],
      })
    );
  }

  const tpRow = new TableRow({
    cantSplit: true,
    children: [
      createLabelCell('Tujuan Pembelajaran'),
      new TableCell({
        width: { size: 75, type: WidthType.PERCENTAGE },
        margins: cellMargin,
        children: tpParagraphs,
      }),
    ],
  });

  // 3. Asesmen
  const assessmentParagraphs: Paragraph[] = [];
  if (meeting.assessments && meeting.assessments.length > 0) {
    meeting.assessments.forEach((a) => {
      const desc = cleanText(a.description || a.method);
      assessmentParagraphs.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { line: 276, after: 40 },
          children: [
            new TextRun({
              text: `• ${a.type ? `[${a.type}] ` : ''}${desc || 'Asesmen'}${a.technique ? ` (Teknik: ${cleanText(a.technique)})` : ''}${a.instrument ? ` (Instrumen: ${cleanText(a.instrument)})` : ''}`,
              size: 22,
              font: 'Times New Roman',
            }),
          ],
        })
      );
    });
  }
  if (assessmentParagraphs.length === 0) {
    assessmentParagraphs.push(
      new Paragraph({
        spacing: { line: 276, after: 40 },
        children: [new TextRun({ text: '-', size: 22, font: 'Times New Roman' })],
      })
    );
  }

  const assessmentRow = new TableRow({
    cantSplit: true,
    children: [
      createLabelCell('Asesmen'),
      new TableCell({
        width: { size: 75, type: WidthType.PERCENTAGE },
        margins: cellMargin,
        children: assessmentParagraphs,
      }),
    ],
  });

  // Meeting summaries come from the same projection used by PDF.
  const kktpParagraphs = (meeting.kktpSummaryLines.length ? meeting.kktpSummaryLines : ['-']).map(text =>
    new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { line: 276, after: 40 },
      children: [new TextRun({ text: cleanText(text), size: 22, font: 'Times New Roman' })] }));
  const activityParagraphs: Paragraph[] = [];
  for (const [phase, label] of [['opening', 'Pendahuluan'], ['core', 'Kegiatan Inti'], ['closing', 'Penutup']]) {
    activityParagraphs.push(new Paragraph({ spacing: { line: 276, before: 60, after: 40 },
      children: [new TextRun({ text: label, bold: true, size: 22, font: 'Times New Roman' })] }));
    const steps = meeting.activities.filter(activity => activity.phase === phase);
    steps.forEach(activity => activityParagraphs.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED, spacing: { line: 276, after: 40 },
      children: [new TextRun({ text: (activity.title ? cleanText(activity.title) + ' — ' : '') + cleanText(activity.description) + ' (' + activity.durationMinutes + ' Menit)', size: 22, font: 'Times New Roman' })],
    })));
    if (phase === 'core') {
      meeting.activities.filter(activity => ['UNDERSTAND', 'APPLY', 'REFLECT'].includes(activity.phase)).forEach(activity => {
        const labels: Record<string, string> = { UNDERSTAND: 'Memahami', APPLY: 'Mengaplikasi', REFLECT: 'Merefleksi' };
        activityParagraphs.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { line: 276, after: 40 },
          children: [new TextRun({ text: labels[activity.phase] + ': ' + cleanText(activity.description) + ' (pendekatan kegiatan inti)', size: 22, font: 'Times New Roman' })] }));
      });
    }
  }
  const activityRow = new TableRow({
    children: [createLabelCell('Kegiatan Pembelajaran'), new TableCell({
      width: { size: 75, type: WidthType.PERCENTAGE }, margins: cellMargin,
      children: activityParagraphs,
    })],
  });

  const kktpRow = new TableRow({
    cantSplit: true,
    children: [
      createLabelCell('KKTP'),
      new TableCell({
        width: { size: 75, type: WidthType.PERCENTAGE },
        margins: cellMargin,
        children: kktpParagraphs,
      }),
    ],
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: tableBorder,
      bottom: tableBorder,
      left: tableBorder,
      right: tableBorder,
      insideHorizontal: tableBorder,
      insideVertical: tableBorder,
    },
    rows: [headerRow, materiRow, tpRow, activityRow, assessmentRow, kktpRow],
  });
}

/**
 * Pure Canonical Document Renderer for Modul Ajar / RPP.
 * Strict M1 Standard:
 * - Times New Roman 12pt black
 * - Margins: Left 3.0cm, Right 2.5cm, Top 2.5cm, Bottom 2.5cm
 * - Prose: Justified with 1.25cm first-line indent, line spacing 1.15
 * - Lists: Left-aligned, no first-line indent, line spacing 1.15
 * - Zero AI metadata, zero product branding, zero student count in final output
 */
export async function generateModulAjar(context: DocumentGenerationContext): Promise<GeneratedDocumentResult> {
  const { school, profile, academicSetting, tp, atp } = context;
  const isBlankMode = context.documentMode === 'blank';

  const sharedProjection = buildModulAjarProjection(context);
  // Uses sharedProjection.meetings directly instead of parsing projection.sections or section.lines
  let plan: LearningPlan | undefined = undefined;
  let resolvedTPs: any[] = [];
  let resolvedAllocatedJP: number | undefined;

  if (isBlankMode) {
    plan = createEmptyLearningPlan({
      academicSetting,
      curriculumType: getCurriculumTypeFromSetting(academicSetting),
      tpIds: [],
      atpItemIds: [],
      context: { tp, atp },
    });
  } else {
    const projection = sharedProjection;
    if (!projection.isReady || !projection.plan) {
      throw new Error(projection.error || 'Modul Ajar belum siap.');
    }
    plan = projection.plan;
    resolvedTPs = projection.resolvedTPs;
    resolvedAllocatedJP = projection.resolvedAllocatedJP;
  }

  const docChildren: (Paragraph | Table)[] = [];

  // Official Title - Clean, centered, bold, black, 14pt (no [DRAFT] or AI tags)
  const docTitle = 'MODUL AJAR';
  const subTitle = `${academicSetting.curriculum || '-'} — ${formatClassLabel(academicSetting)} (${academicSetting.phase || '-'})`;

  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: docTitle,
          bold: true,
          size: 28, // 14pt
          font: 'Times New Roman',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [
        new TextRun({
          text: subTitle.toUpperCase(),
          bold: true,
          size: 24, // 12pt
          font: 'Times New Roman',
        }),
      ],
    })
  );

  // Time / JP allocation resolution
  const timeAllocationDisplay = isBlankMode
    ? '................ Jam Pelajaran (JP)'
    : resolvedAllocatedJP !== undefined
    ? `${resolvedAllocatedJP} Jam Pelajaran (JP)`
    : 'Belum Ditetapkan';

  // Identity Table
  const isK13Curriculum =
    academicSetting.curriculumType === 'K13' ||
    (academicSetting.curriculum &&
      (academicSetting.curriculum.includes('2013') || academicSetting.curriculum.includes('K13')));

  const classRow: [string, string] = isK13Curriculum
    ? ['Kelas', `: ${formatClassLabel(academicSetting)}`]
    : ['Fase / Kelas', `: ${academicSetting.phase || '-'} / ${formatClassLabel(academicSetting)}`];

  const identityRows: [string, string][] = [
    ['Satuan Pendidikan', `: ${school.name || '-'}`],
    ['NPSN', `: ${school.npsn || '-'}`],
    ['Mata Pelajaran', `: ${academicSetting.subject || '-'}`],
    classRow,
    ['Tahun Ajaran / Semester', `: ${academicSetting.academicYear || '-'} / ${academicSetting.semester || '-'}`],
    ['Guru Mata Pelajaran', `: ${profile.name || '-'}`],
    ['NIP', `: ${profile.nip || '-'}`],
    ['Alokasi Waktu', `: ${timeAllocationDisplay}`],
    ['Topik / Materi', `: ${plan.topic || plan.title || '-'}`],
    ...(academicSetting.planningReferenceNotice ? [['Acuan Waktu', `: ${academicSetting.planningReferenceNotice}`] as [string, string]] : []),
  ];

  docChildren.push(createModulAjarIdentityTable(identityRows));
  docChildren.push(new Paragraph({ spacing: { after: 180 } }));

  // Helper: Section Title (12pt Bold Black)
  const addSectionTitle = (title: string) => {
    docChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 180, after: 80 },
        children: [
          new TextRun({
            text: title,
            bold: true,
            size: 24, // 12pt
            font: 'Times New Roman',
          }),
        ],
      })
    );
  };

  // Helper: Subsection Title (12pt Bold Black)
  const addSubSectionTitle = (title: string) => {
    docChildren.push(
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [
          new TextRun({
            text: title,
            bold: true,
            size: 24, // 12pt
            font: 'Times New Roman',
          }),
        ],
      })
    );
  };


  // Helper: Narrative Prose Paragraph (12pt Justified, 1.25cm first-line indent, line spacing 1.15, 6pt after)
  const addProseParagraph = (text: string) => {
    const cleaned = cleanText(text);
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        indent: { firstLine: 709 }, // 1.25 cm = 708.66 twips
        spacing: { line: 276, after: 120 }, // 1.15 line spacing, 6pt after
        children: [
          new TextRun({
            text: cleaned || '-',
            size: 24, // 12pt
            font: 'Times New Roman',
          }),
        ],
      })
    );
  };

  // Helper: List Paragraph (12pt Justified, NO first-line indent, line spacing 1.15, 4pt after)
  const addListParagraph = (text: string, boldPrefix?: string) => {
    const cleaned = cleanText(text) || '-';
    const runs: TextRun[] = [];
    if (boldPrefix) {
      runs.push(
        new TextRun({
          text: boldPrefix,
          bold: true,
          size: 24,
          font: 'Times New Roman',
        })
      );
    }
    runs.push(
      new TextRun({
        text: cleaned,
        size: 24,
        font: 'Times New Roman',
      })
    );
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { line: 276, after: 80 },
        children: runs,
      })
    );
  };

  // Compile Profil dimensions (prefer canonical graduateProfileDimensions, backward compatible with p3Dimensions)
  const explicitDimensions =
    plan.graduateProfileDimensions && plan.graduateProfileDimensions.length > 0
      ? plan.graduateProfileDimensions
      : plan.p3Dimensions && plan.p3Dimensions.length > 0
      ? plan.p3Dimensions
      : [];
  const dimensionsText = explicitDimensions.length > 0 ? explicitDimensions.join(', ') : '-';

  if (!isBlankMode) {
    // I. INFORMASI UMUM
    addSectionTitle('I. INFORMASI UMUM');

    // A. Kompetensi Awal
    addSubSectionTitle('A. Kompetensi Awal');
    addProseParagraph(plan.initialCompetency || '-');

    // B. Dimensi Profil Lulusan
    addSubSectionTitle('B. Dimensi Profil Lulusan');
    addListParagraph(dimensionsText);

    // C. Sarana dan Prasarana
    addSubSectionTitle('C. Sarana dan Prasarana');
    if (plan.resources && plan.resources.length > 0) {
      plan.resources.forEach((r, i) => {
        addListParagraph(`${i + 1}. ${cleanText(r.title)}${r.source ? ` (${cleanText(r.source)})` : ''}`);
      });
    } else {
      addListParagraph('-');
    }

    // D. Karakteristik/Kebutuhan Belajar Murid (optional)
    let nextLetterCode = 68; // ASCII 'D'
    if (plan.targetStudents && cleanText(plan.targetStudents).length > 0) {
      addSubSectionTitle(`${String.fromCharCode(nextLetterCode)}. Karakteristik/Kebutuhan Belajar Murid`);
      addProseParagraph(cleanText(plan.targetStudents));
      nextLetterCode++;
    }

    // Model/Praktik Pembelajaran
    addSubSectionTitle(`${String.fromCharCode(nextLetterCode)}. Model/Praktik Pembelajaran`);
    addProseParagraph(plan.learningModel || '-');

    // II. KOMPONEN INTI
    addSectionTitle('II. KOMPONEN INTI');

    // A. Tujuan Pembelajaran (TP)
    addSubSectionTitle('A. Tujuan Pembelajaran (TP)');
    if (resolvedTPs.length > 0) {
      resolvedTPs.forEach((t, idx) => {
        addListParagraph(`${idx + 1}. ${t.code ? `[${t.code}] ` : ''}${cleanText(t.statement)}${t.materialScope ? ` (Materi: ${cleanText(t.materialScope)})` : ''}`);
      });
    } else {
      addListParagraph('-');
    }

    // B. Pemahaman Bermakna
    addSubSectionTitle('B. Pemahaman Bermakna');
    addProseParagraph(plan.meaningfulUnderstanding || '-');

    // C. Pertanyaan Pemantik
    addSubSectionTitle('C. Pertanyaan Pemantik');
    if (plan.triggerQuestions && plan.triggerQuestions.length > 0) {
      plan.triggerQuestions.forEach((q, idx) => {
        const cleanedQ = cleanText(q);
        if (cleanedQ) {
          addListParagraph(`${idx + 1}. ${cleanedQ}`);
        }
      });
    } else {
      addListParagraph('-');
    }

    // III. RENCANA PERTEMUAN
    // Gunakan langsung sharedProjection.meetings; jangan parsing section.lines.
    addSectionTitle('III. RENCANA PERTEMUAN');
    const sortedMeetings = (sharedProjection.meetings || []).slice().sort((a, b) => a.order - b.order);
    if (sortedMeetings.length > 0) {
      sortedMeetings.forEach((m) => {
        docChildren.push(createModulAjarMeetingTable(m));
        docChildren.push(new Paragraph({ spacing: { after: 180 } }));
      });
    } else {
      addListParagraph('-');
    }

    // IV. ASESMEN + KKTP
    addSectionTitle('IV. ASESMEN + KKTP');

    // A. Rencana Asesmen
    addSubSectionTitle('A. Rencana Asesmen (Awal, Formatif, Sumatif)');
    const renderAssessmentGroup = (subNum: string, label: string, items?: typeof plan.assessmentPlan.initial) => {
      addSubSectionTitle(`${subNum} ${label}`);
      if (!items || items.length === 0) {
        addListParagraph('-');
      } else {
        items.forEach((a) => {
          const desc = cleanText(a.description || a.method);
          addListParagraph(
            `• ${a.type ? `[${a.type}] ` : ''}${desc || 'Asesmen'}${a.technique ? ` (Teknik: ${cleanText(a.technique)})` : ''}${a.instrument ? ` (Instrumen: ${cleanText(a.instrument)})` : ''}`
          );
        });
      }
    };

    renderAssessmentGroup('1.', 'Asesmen Awal (Diagnostik)', plan.assessmentPlan?.initial);
    renderAssessmentGroup('2.', 'Asesmen Formatif', plan.assessmentPlan?.formative);
    renderAssessmentGroup('3.', 'Asesmen Sumatif', plan.assessmentPlan?.summative);

    // B. KKTP terstruktur per TP
    addSubSectionTitle('B. Kriteria Ketercapaian Tujuan Pembelajaran (KKTP)');
    const scopedCriteria = (context.assessmentCriteria || []).filter(
      (c) =>
        c.academicSettingId === context.academicSetting.id &&
        plan!.tpIds.includes(c.tpId) &&
        (!plan!.kktpCriterionIds?.length || plan!.kktpCriterionIds.includes(c.id))
    );

    if (scopedCriteria.length > 0) {
      scopedCriteria.forEach((c) => {
        const tp = resolvedTPs.find((t) => t.id === c.tpId);
        if (tp) {
          addListParagraph(`[${tp.code || tp.id}] ${cleanText(tp.statement)}`, 'Tujuan Pembelajaran: ');
        }
        addListParagraph(cleanText(c.description) || '-', 'Kriteria: ');
        addListParagraph(
          c.indicators && c.indicators.length > 0 ? c.indicators.map(cleanText).filter(Boolean).join('; ') : '-',
          'Indikator: '
        );
        addListParagraph(getLevelDesc(c.levels, 'Perlu Bimbingan'), '• Perlu Bimbingan: ');
        addListParagraph(getLevelDesc(c.levels, 'Cukup'), '• Cukup: ');
        addListParagraph(getLevelDesc(c.levels, 'Baik'), '• Baik: ');
        addListParagraph(getLevelDesc(c.levels, 'Sangat Baik'), '• Sangat Baik: ');
        docChildren.push(new Paragraph({ spacing: { after: 100 } }));
      });
    } else {
      addListParagraph('-');
    }

    // V. DIFERENSIASI
    addSectionTitle('V. DIFERENSIASI');
    if (
      plan.differentiation &&
      (cleanText(plan.differentiation.content) ||
        cleanText(plan.differentiation.process) ||
        cleanText(plan.differentiation.product) ||
        cleanText(plan.differentiation.notes))
    ) {
      if (cleanText(plan.differentiation.content)) addListParagraph(cleanText(plan.differentiation.content), '• Diferensiasi Konten: ');
      if (cleanText(plan.differentiation.process)) addListParagraph(cleanText(plan.differentiation.process), '• Diferensiasi Proses: ');
      if (cleanText(plan.differentiation.product)) addListParagraph(cleanText(plan.differentiation.product), '• Diferensiasi Produk: ');
      if (cleanText(plan.differentiation.notes)) addListParagraph(cleanText(plan.differentiation.notes), '• Catatan: ');
    } else {
      addListParagraph('-');
    }

    // VI. PENGAYAAN/REMEDIAL
    addSectionTitle('VI. PENGAYAAN/REMEDIAL');
    addSubSectionTitle('A. Rencana Pengayaan');
    addProseParagraph(cleanText(plan.enrichmentPlan) || '-');
    addSubSectionTitle('B. Rencana Remedial');
    addProseParagraph(cleanText(plan.remedialPlan) || '-');

    // VII. REFLEKSI
    addSectionTitle('VII. REFLEKSI');
    addSubSectionTitle('A. Refleksi Guru');
    addProseParagraph(cleanText(plan.reflection?.teacherReflection) || '-');
    addSubSectionTitle('B. Refleksi Murid');
    addProseParagraph(cleanText(plan.reflection?.studentReflection) || '-');
  } else {
    // Blank Mode template
    // I. INFORMASI UMUM
    addSectionTitle('I. INFORMASI UMUM');

    addSubSectionTitle('A. Kompetensi Awal');
    addProseParagraph('........................................................................................................................');

    addSubSectionTitle('B. Dimensi Profil Lulusan');
    addListParagraph('........................................................................................................................');

    addSubSectionTitle('C. Sarana dan Prasarana');
    addListParagraph('........................................................................................................................');

    addSubSectionTitle('D. Model/Praktik Pembelajaran');
    addProseParagraph('........................................................................................................................');

    // II. KOMPONEN INTI
    addSectionTitle('II. KOMPONEN INTI');

    addSubSectionTitle('A. Tujuan Pembelajaran (TP)');
    addListParagraph('........................................................................................................................');

    addSubSectionTitle('B. Pemahaman Bermakna');
    addProseParagraph('........................................................................................................................');

    addSubSectionTitle('C. Pertanyaan Pemantik');
    addListParagraph('........................................................................................................................');

    // III. RENCANA PERTEMUAN
    addSectionTitle('III. RENCANA PERTEMUAN');
    addListParagraph('........................................................................................................................');

    // IV. ASESMEN + KKTP
    addSectionTitle('IV. ASESMEN + KKTP');
    addSubSectionTitle('A. Rencana Asesmen');
    addListParagraph('........................................................................................................................');
    addSubSectionTitle('B. Kriteria Ketercapaian Tujuan Pembelajaran (KKTP)');
    addListParagraph('........................................................................................................................');

    // V. DIFERENSIASI
    addSectionTitle('V. DIFERENSIASI');
    addListParagraph('........................................................................................................................');

    // VI. PENGAYAAN/REMEDIAL
    addSectionTitle('VI. PENGAYAAN/REMEDIAL');
    addSubSectionTitle('A. Rencana Pengayaan');
    addProseParagraph('........................................................................................................................');
    addSubSectionTitle('B. Rencana Remedial');
    addProseParagraph('........................................................................................................................');

    // VII. REFLEKSI
    addSectionTitle('VII. REFLEKSI');
    addSubSectionTitle('A. Refleksi Guru');
    addProseParagraph('........................................................................................................................');
    addSubSectionTitle('B. Refleksi Murid');
    addProseParagraph('........................................................................................................................');
  }

  // Signoff Block in Times New Roman
  docChildren.push(
    ...createModulAjarSignoffBlock(
      school,
      profile,
      isBlankMode,
      context.documentDate
    )
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1417, // 2.5 cm (2.5 * 566.929 = 1417 twips)
              bottom: 1417, // 2.5 cm
              left: 1701, // 3.0 cm (3.0 * 566.929 = 1701 twips)
              right: 1417, // 2.5 cm
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const snapshot = context.snapshot || createDocumentSnapshot(context, 'docx', context.documentMode, 'MODUL_AJAR');
  recordModulAjarExportDiagnostic(context, sharedProjection, snapshot, 'docx');
  const cleanSubject = (academicSetting.subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_');
  const cleanGrade = (academicSetting.grade || 'Kelas').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `MODUL_AJAR_${cleanSubject}_${cleanGrade}_${new Date().toISOString().slice(0, 10)}.docx`;

  if (!context.skipDownload) {
    saveAs(blob, fileName);
  }

  return {
    success: true,
    type: 'MODUL_AJAR',
    title: docTitle,
    fileName,
    blob,
    document: doc,
    record: {
      id: `doc-modul-${Date.now()}`,
      type: 'MODUL_AJAR',
      title: docTitle,
      status: 'completed',
      lastGenerated: new Date().toISOString(),
      fileName,
      academicSettingId: academicSetting.id,
      workspaceId: context.workspace?.id,
      snapshot,
    },
  };
}
