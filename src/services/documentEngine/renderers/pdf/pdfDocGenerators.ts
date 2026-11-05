import { buildJurnalProjection, JURNAL_COLUMNS, JURNAL_WIDTHS, jurnalTableRows } from '../../jurnalProjection';
import { buildPromesPresentation, formatAllocationStatusIndonesian } from '../../promesPresentation';
import { sourceIdentityExportIssue } from '../../sourceIdentityGuard';
import { importDocumentPolicyIssue } from '../../../administrationImportPolicy';
import { calendarDayLabel } from '../../calendarPresentation';
import { ATP_DOCUMENT_COLUMNS, buildATPDocumentProjection, getATPDocumentRowCells } from '../../atpDocumentProjection';
import { recordModulAjarExportDiagnostic } from '../../modulAjarExportDiagnostics';
import {
  DocumentType,
  DocumentGenerationContext,
  DocumentSnapshot,
} from '../../types';
import { ATPItem, TimeAllocation } from '../../../../types';
import {
  PdfDocumentBuilder,
  PdfDocumentSection,
  buildPdfFromOptions,
} from './pdfRenderer';
import { formatOfficialDate, PdfStyleProfile, PDF_THEME } from './pdfTheme';
import { resolveEffectiveContext, createDocumentSnapshot } from '../../snapshot';
import { exportAssessmentPdf } from '../../assessmentExportService';
import { normalizeSemester } from '../../../academicScope';
import { buildPromesProjection, buildAlokasiWaktuProjection } from '../../promesProjection';
import { buildProtaProjection, buildK13ProtaProjection } from '../../protaProjection';
import { buildModulAjarProjection } from '../../modulAjarProjection';
import { buildK13AlokasiWaktuRows } from '../../k13AlokasiWaktuHelper';
import { resolveMerdekaCanonicalTimeProjection } from '../../meetingTimeProjection';

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

function resolveAllocationForAtpPdf(
  atpItem: ATPItem,
  timeAllocations?: TimeAllocation[]
): { weekStr: string; jpStr: string } {
  if (!timeAllocations || timeAllocations.length === 0) {
    return { weekStr: '-', jpStr: '-' };
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
    return { weekStr: '-', jpStr: '-' };
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

  return { weekStr, jpStr };
}

export async function generatePdfDocument(
  type: DocumentType,
  rawContext: DocumentGenerationContext
): Promise<{ blob: Blob; fileName: string; title: string; snapshot: DocumentSnapshot }> {
  const context = resolveEffectiveContext(rawContext);
  const identityIssue = sourceIdentityExportIssue(type, context);
  if (identityIssue) throw new Error(identityIssue);
  const importIssue = importDocumentPolicyIssue(type, context);
  if (importIssue) throw new Error(importIssue);

  if (type === 'ASESMEN') {
    const result = await exportAssessmentPdf(context, {
      documentMode: context.documentMode,
      documentDate: context.documentDate,
    });
    return {
      blob: result.blob,
      fileName: result.fileName,
      title: result.title,
      snapshot: result.snapshot,
    };
  }

  const snapshot = context.snapshot || createDocumentSnapshot(context, 'pdf', context.documentMode, type);
  const { school, profile, academicSetting, cp, tp, atp, students, calendarDays, timeAllocations, k13Analysis } = context;
  const isBlankMode = context.documentMode === 'blank';

  const subject = academicSetting?.subject || '-';
  const grade = academicSetting?.grade || '-';
  const semester = academicSetting?.semester || '-';
  const academicYear = academicSetting?.academicYear || '-';
  const cleanSubject = (subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_');
  const cleanGrade = (grade || 'Kelas').replace(/[^a-zA-Z0-9]/g, '_');

  let title = '';
  let subTitle = '';
  let fileName = '';
  let orientation: 'portrait' | 'landscape' = 'portrait';
  let extraIdentityRows: [string, string][] = [];
  const sections: PdfDocumentSection[] = [];

  switch (type) {
    case 'CP': {
      title = 'Capaian Pembelajaran (CP) Resmi';
      subTitle = `${subject} — ${grade} (${academicSetting?.phase || 'Fase A'})`;
      fileName = `CP_${cleanSubject}_${cleanGrade}.pdf`;

      if (cp?.source && !isBlankMode) {
        sections.push({
          type: 'callout',
          title: 'Sumber Rujukan Resmi',
          text: `${cp.source.title || 'Salinan Keputusan BSKAP'} (${cp.source.institution || 'Kemendikdasmen RI'}, ${cp.source.documentYear || '2024'})${cp.source.url ? ` — ${cp.source.url}` : ''}`,
        });
      }

      sections.push({
        type: 'heading',
        text: 'A. Deskripsi Capaian Pembelajaran Fase',
        level: 1,
      });

      const cpGeneralText = isBlankMode
        ? '........................................................................................................................................................................................................................................................................................'
        : cp?.generalDescription?.trim()
        ? cp.generalDescription.trim()
        : (cp?.elements && cp.elements.length > 0)
        ? 'Capaian Pembelajaran pada fase ini dirinci melalui elemen-elemen berikut.'
        : '-';

      sections.push({
        type: 'paragraph',
        text: cpGeneralText,
        align: 'justify',
      });

      sections.push({
        type: 'heading',
        text: 'B. Capaian Pembelajaran per Elemen',
        level: 1,
      });

      const rows = isBlankMode
        ? Array.from({ length: 12 }, (_, idx) => [idx + 1, '....................', '..........................................................................................'])
        : (cp?.elements && cp.elements.length > 0)
        ? cp.elements.map((elem, idx) => [
            idx + 1,
            elem.name || '—',
            elem.content || '—',
          ])
        : [[1, 'Semua Elemen', cp?.generalDescription || '-']];

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Elemen', dataKey: 'elem', width: 32 },
          { header: 'Capaian Pembelajaran Elemen', dataKey: 'content', width: 115 },
        ],
        rows,
      });
      break;
    }

    case 'ANALISIS_CP_TP': {
      title = 'Analisis Capaian Pembelajaran Menjadi Tujuan Pembelajaran';
      subTitle = `${subject} — ${grade} (${academicSetting?.phase || 'Fase A'})`;
      fileName = `Analisis_CP_TP_${cleanSubject}_${cleanGrade}.pdf`;

      sections.push({
        type: 'heading',
        text: 'A. Rasional & Capaian Pembelajaran Umum',
        level: 1,
      });

      const cpAnalysisGeneralText = isBlankMode
        ? '................................................................................................................................................................................................................................'
        : cp?.generalDescription?.trim()
        ? cp.generalDescription.trim()
        : (cp?.elements && cp.elements.length > 0)
        ? 'Capaian Pembelajaran pada fase ini dirinci melalui elemen-elemen berikut.'
        : '-';

      sections.push({
        type: 'paragraph',
        text: cpAnalysisGeneralText,
        align: 'justify',
      });

      sections.push({
        type: 'heading',
        text: 'B. Matriks Telaah Penurunan CP ke Tujuan Pembelajaran',
        level: 1,
      });

      const rows: (string | number)[][] = isBlankMode
        ? Array.from({ length: 15 }, (_, idx) => [
            idx + 1,
            '....................',
            '....................',
            '....................',
            '........................................',
            '....................',
          ])
        : (tp?.items || []).length > 0
        ? (tp?.items || []).map((it, idx) => [
            idx + 1,
            it.elementName || '—',
            it.competence || '—',
            it.contentScope || '—',
            it.statement || '—',
            (it.p3Dimensions || []).join(', ') || '-',
          ])
        : [[1, '—', '—', '—', '-', '—']];

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Elemen CP', dataKey: 'elem', width: 24 },
          { header: 'Kompetensi (KKO)', dataKey: 'comp', width: 24 },
          { header: 'Lingkup Materi', dataKey: 'mat', width: 27 },
          { header: 'Rumusan Tujuan Pembelajaran (TP)', dataKey: 'tp', width: 48 },
          { header: 'Dimensi P3', dataKey: 'p3', width: 24 },
        ],
        rows,
      });
      break;
    }

    case 'TP': {
      title = 'Dokumen Perumusan Tujuan Pembelajaran (TP)';
      subTitle = `${subject} — ${grade} (${academicSetting?.phase || 'Fase A'}) — Tahun Ajaran ${academicYear}`;
      fileName = `Tujuan_Pembelajaran_${cleanSubject}_${cleanGrade}.pdf`;

      sections.push({
        type: 'heading',
        text: 'Daftar Tujuan Pembelajaran yang Telah Dirumuskan',
        level: 1,
      });

      const rows = isBlankMode
        ? Array.from({ length: 15 }, (_, idx) => [
            idx + 1,
            `TP ${idx + 1}`,
            '..........................................................................................',
            '....................',
            '....................',
          ])
        : (tp?.items || []).length > 0
        ? (tp?.items || []).map((it, idx) => [
            idx + 1,
            it.code || `TP ${idx + 1}`,
            it.statement || '-',
            it.contentScope || '-',
            (it.p3Dimensions || []).join(', ') || '-',
          ])
        : [[1, '—', '-', '—', '—']];

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Kode TP', dataKey: 'code', width: 17, align: 'center' },
          { header: 'Pernyataan Tujuan Pembelajaran', dataKey: 'statement', width: 68 },
          { header: 'Lingkup Materi', dataKey: 'mat', width: 34 },
          { header: 'Dimensi Profil Lulusan', dataKey: 'p3', width: 28 },
        ],
        rows,
      });
      break;
    }

    case 'ATP': {
      const projection = buildATPDocumentProjection(context);
      if (!projection.isReady) throw new Error(projection.error || 'ATP belum siap diekspor.');
      title = 'Alur Tujuan Pembelajaran (ATP)';
      subTitle = subject + ' — ' + grade + ' (' + (academicSetting?.phase || '-') + ')';
      fileName = 'ATP_' + cleanSubject + '_' + cleanGrade + '.pdf';
      orientation = 'portrait';
      if (projection.rationale) {
        sections.push({ type: 'heading', text: 'A. Rasionalisasi Alur Pembelajaran', level: 1 });
        sections.push({ type: 'paragraph', text: projection.rationale, align: 'justify' });
      }
      if (projection.cpReferenceLines.length) {
        sections.push({ type: 'heading', text: 'B. Capaian Pembelajaran Rujukan', level: 1 });
        sections.push({ type: 'paragraph', text: projection.cpReferenceLines.join('\n'), align: 'justify' });
      }
      sections.push({ type: 'heading', text: 'C. Matriks Alur Tujuan Pembelajaran', level: 1 });
      const contentWidth = 210 - PDF_THEME.margins.portrait.left - PDF_THEME.margins.portrait.right;
      sections.push({
        type: 'table',
        columns: ATP_DOCUMENT_COLUMNS.map((header, index) => ({
          header,
          dataKey: ['stage', 'tp', 'atp'][index],
          width: contentWidth * [0.12, 0.48, 0.40][index],
          align: index === 0 ? 'center' : 'left',
        })),
        rows: projection.rows.map(row => getATPDocumentRowCells(row).map(lines => lines.join('\n'))),
      });
      break;
    }

    case 'PEMETAAN_ATP_UNIT': {
      title = 'Pemetaan ATP, Unit/Bab, dan Lingkup Materi';
      subTitle = `${subject} — ${grade} (${academicSetting?.phase || 'Fase A'}) — Tahun Ajaran ${academicYear}`;
      fileName = `Pemetaan_ATP_Unit_${cleanSubject}_${cleanGrade}.pdf`;
      orientation = 'landscape';

      sections.push({
        type: 'heading',
        text: 'Matriks Pemetaan Alur Tujuan Pembelajaran berdasarkan Unit / Bab',
        level: 1,
      });

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
      let rows: (string | number)[][];

      if (isBlankMode) {
        rows = Array.from({ length: 8 }, (_, idx) => [
          idx === 0 ? 'Unit 1' : '',
          idx === 0 ? 'TP-01 → TP-02' : '',
          `Langkah ${idx + 1}`,
          '..................................................',
          'Minggu .....',
          '..... JP',
        ]);
      } else {
        const sortedItems = [...(atp?.items || [])].sort(
          (a, b) => (a.stepNumber || 0) - (b.stepNumber || 0)
        );

        interface UnitGroup {
          unitTitle: string;
          items: ATPItem[];
        }
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

        const dataRows: (string | number)[][] = [];

        for (const group of groups) {
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

            const alloc = resolveAllocationForAtpPdf(item, uniqueAllocations);
            const materialText =
              item.materialScope || resolvedTp?.contentScope || '-';

            dataRows.push([
              isFirstInGroup ? group.unitTitle : '',
              isFirstInGroup ? tpChainStr : '',
              `Langkah ${item.stepNumber || itemIdx + 1}`,
              materialText,
              alloc.weekStr,
              alloc.jpStr,
            ]);
          });
        }

        rows = dataRows.length > 0 ? dataRows : [['—', '—', '—', 'Belum ada data ATP', '—', '—']];
      }

      sections.push({
        type: 'table',
        columns: [
          { header: 'Unit / Bab', dataKey: 'unit', width: 44 },
          { header: 'TP dalam ATP', dataKey: 'tpChain', width: 48 },
          { header: 'ATP Langkah', dataKey: 'step', width: 26, align: 'center' },
          { header: 'Lingkup Materi', dataKey: 'mat', width: 75 },
          { header: 'Minggu', dataKey: 'week', width: 35, align: 'center' },
          { header: 'JP', dataKey: 'jp', width: 24, align: 'center' },
        ],
        rows,
      });
      break;
    }

    case 'PROTA': {
      const isK13 = academicSetting?.curriculumType === 'K13' || academicSetting?.curriculum === 'Kurikulum 2013';

      if (isK13) {
        const k13Proj = buildK13ProtaProjection(context);

        if (!isBlankMode && !k13Proj.isReady) {
          throw new Error(
            k13Proj.unreadyReason ||
              'Program Tahunan belum dapat dibuat karena data analisis KD Kurikulum 2013 belum tersedia.'
          );
        }

        title = 'Program Tahunan (PROTA)';
        subTitle = `${subject} — ${grade} — Tahun Ajaran ${k13Proj.academicYear}`;
        fileName = `PROTA_${cleanSubject}_${cleanGrade}.pdf`;

        let rows: any[] = [];
        if (isBlankMode) {
          rows = Array.from({ length: 15 }, (_, idx) => [
            idx + 1,
            '....................',
            '..........................................................................................',
            '..... JP',
            '....................',
          ]);
        } else {
          rows = k13Proj.rows.map((r, idx) => [
            idx + 1,
            r.kd,
            `${r.materi}\nKegiatan: ${r.kegiatan}`,
            `${r.allocatedJP} JP`,
            r.semester ? `Semester ${r.semester}` : '-',
          ]);

          rows.push([
            'TOTAL',
            '',
            'TOTAL ALOKASI JP TERCATAT',
            `${k13Proj.totalAllocatedJP} JP`,
            '',
          ]);
        }

        sections.push({
          type: 'table',
          columns: [
            { header: 'No', dataKey: 'no', width: 8, align: 'center' },
            { header: 'Kompetensi Dasar (KD)', dataKey: 'code', width: 20, align: 'center' },
            { header: 'Materi Pokok & Kegiatan Pembelajaran', dataKey: 'materi', width: 94 },
            { header: 'Alokasi JP', dataKey: 'jp', width: 16, align: 'center' },
            { header: 'Semester', dataKey: 'sem', width: 17, align: 'center' },
          ],
          rows,
        });
        break;
      }

      const projection = buildProtaProjection(context);

      if (!isBlankMode && !projection.isReady) {
        throw new Error(
          projection.unreadyReason ||
            'Program Tahunan belum dapat dibuat karena alokasi distribusi semester belum lengkap.'
        );
      }

      title = 'Program Tahunan (PROTA)';
      subTitle = `${subject} — ${grade} — Tahun Ajaran ${projection.academicYear}`;
      fileName = `PROTA_${cleanSubject}_${cleanGrade}.pdf`;

      let rows: any[] = [];
      if (isBlankMode) {
        rows = Array.from({ length: 15 }, (_, idx) => [
          idx + 1,
          '....................',
          '..........................................................................................',
          '....................',
          '..... JP',
          '....................',
        ]);
      } else {
        const s1Atp = projection.rows.filter((r) => r.semester === 1);
        const s1Assess = projection.assessmentRows.filter((r) => r.semester === 1);
        const s1Reserve = projection.reserveRows.filter((r) => r.semester === 1);

        const s2Atp = projection.rows.filter((r) => r.semester === 2);
        const s2Assess = projection.assessmentRows.filter((r) => r.semester === 2);
        const s2Reserve = projection.reserveRows.filter((r) => r.semester === 2);

        const allOrderedRows = [
          ...s1Atp,
          ...s1Assess,
          ...s1Reserve,
          ...s2Atp,
          ...s2Assess,
          ...s2Reserve,
        ];

        rows = allOrderedRows.map((r, idx) => [
          idx + 1,
          r.tpCode,
          r.tpStatement,
          r.materialScope,
          `${r.allocatedJP} JP`,
          `Semester ${r.semester}`,
        ]);

        rows.push([
          'TOTAL',
          '',
          'TOTAL ALOKASI JP TERCATAT',
          '',
          `${projection.totalAllocatedJP} JP`,
          '',
        ]);
      }

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Kode / Jenis', dataKey: 'code', width: 17, align: 'center' },
          { header: 'Tujuan Pembelajaran / Kegiatan', dataKey: 'tp', width: 56 },
          { header: 'Lingkup Materi', dataKey: 'mat', width: 38 },
          { header: 'Alokasi JP', dataKey: 'jp', width: 16, align: 'center' },
          { header: 'Semester', dataKey: 'sem', width: 20, align: 'center' },
        ],
        rows,
      });

      if (!isBlankMode) {
        const lines: string[] = [
          `• Alokasi Semester 1: ${projection.semester1AllocatedJP} JP`,
          `• Alokasi Semester 2: ${projection.semester2AllocatedJP} JP`,
          `• Total Alokasi Tahunan: ${projection.totalAllocatedJP} JP`,
          `• Acuan Intrakurikuler Tahunan: ${projection.officialAnnualJP !== null ? `${projection.officialAnnualJP} JP` : '—'}`,
          `• Selisih terhadap Acuan JP: ${projection.remainingAnnualJP !== null ? `${projection.remainingAnnualJP} JP` : '—'}`,
        ];
        if (projection.availableAnnualJP !== null && projection.availableAnnualJP !== undefined) {
          lines.push(`• Target Alokasi Waktu Tahunan: ${projection.availableAnnualJP} JP`);
        }
        if (projection.unallocatedAnnualJP !== null && projection.unallocatedAnnualJP !== undefined) {
          lines.push(`• Selisih Alokasi terhadap Target: ${projection.unallocatedAnnualJP} JP`);
        }
        if (projection.referenceWeeklyEquivalentJP !== null) {
          lines.push(`• Referensi Ekuivalen JP per Minggu: ${projection.referenceWeeklyEquivalentJP} JP / Minggu`);
        }
        sections.push({
          type: 'heading',
          text: 'Ringkasan Alokasi Waktu Tahunan',
          level: 2,
        });
        sections.push({
          type: 'paragraph',
          text: lines.join('\n'),
        });
      }
      break;
    }

    case 'PROMES': {
      const projection = buildPromesProjection(context);

      if (context.documentMode !== 'blank' && !projection.isReady) {
        throw new Error(
          projection.unreadyReason ||
            'Program Semester belum dapat dibuat karena prasyarat semester aktif belum lengkap.'
        );
      }

      title = 'Program Semester (PROMES)';
      subTitle = `${subject} — ${grade} — Semester ${projection.semester} — T.A ${academicYear} | Total ${projection.totalAllocatedJP} JP`;
      fileName = `PROMES_${cleanSubject}_${cleanGrade}.pdf`;
      orientation = 'landscape';

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

      extraIdentityRows = [
        ['Alokasi Intrakurikuler per Minggu', `: ${weeklyJpText}`],
        ['Minggu Efektif Semester', `: ${weeksText}`],
        ['Alokasi JP Semester', `: ${availableJpText}`],
      ];

      sections.push({
        type: 'heading',
        text: 'Matriks Distribusi Alokasi Waktu Pembelajaran Bulanan',
        level: 1,
      });

      const presentation = buildPromesPresentation(projection, isBlankMode);
      const contentWidth = 297 - PDF_THEME.margins.landscape.left - PDF_THEME.margins.landscape.right;
      sections.push({
        type: 'table',
        columns: presentation.headers.map((header, index) => ({
          header, dataKey: 'c' + index, width: contentWidth * presentation.widths[index] / 100, align: presentation.alignments[index],
        })),
        rows: [...presentation.rows, ...presentation.summaryRows],
      });
      sections.push({ type: 'heading', text: 'Status & Catatan Pelaksanaan', level: 2 });
      sections.push({ type: 'paragraph', text: presentation.notes });
      break;
    }

    case 'MODUL_AJAR': {
      const projection = buildModulAjarProjection(context);

      if (!isBlankMode) {
        if (!projection.isReady || !projection.plan) {
          throw new Error(projection.error || 'PDF Modul Ajar belum siap.');
        }
      }

      const matchedPlan = projection.plan;

      title = isBlankMode ? 'Format Kosong Modul Ajar / RPP Berdiferensiasi' : 'Modul Ajar / RPP Berdiferensiasi';
      subTitle = `${subject} — ${grade} (${academicSetting?.phase || '-'}) — Semester ${semester}`;
      fileName = `Modul_Ajar_${cleanSubject}_${cleanGrade}.pdf`;

      if (!isBlankMode) {
        sections.push({ type: 'paragraph', text: [
          'Satuan Pendidikan: ' + (school.name || '-'), 'NPSN: ' + (school.npsn || '-'),
          'Guru Mata Pelajaran: ' + (profile.name || '-'), 'NIP: ' + (profile.nip || '-'),
          'Tahun Ajaran: ' + academicYear, 'Topik / Materi: ' + (matchedPlan?.topic || matchedPlan?.title || '-'),
          'Alokasi Waktu: ' + projection.resolvedAllocatedJP + ' JP',
        ].join('\n') });
        for (const section of projection.sections || []) {
          sections.push({ type: 'heading', text: section.title, level: 1 });
          if (section.lines.length) sections.push({ type: 'paragraph', text: section.lines.join('\n') });
        }
        break;
      }

      // Compile TP string strictly from canonical resolved TPs
      const tpStatements =
        projection.resolvedTPs.length > 0
          ? projection.resolvedTPs
              .map((t, idx) => `${idx + 1}. ${t.code ? `[${t.code}] ` : ''}${t.statement}`)
              .join('\n')
          : '-';

      const dimensionsList =
        matchedPlan?.graduateProfileDimensions && matchedPlan.graduateProfileDimensions.length > 0
          ? matchedPlan.graduateProfileDimensions
          : matchedPlan?.p3Dimensions && matchedPlan.p3Dimensions.length > 0
          ? matchedPlan.p3Dimensions
          : [];
      const dimensionsStr = dimensionsList.length > 0 ? dimensionsList.join(', ') : '-';

      const resourcesStr = matchedPlan?.resources && matchedPlan.resources.length > 0
        ? matchedPlan.resources.map((r, i) => `${i + 1}. ${r.title}${r.source ? ` (${r.source})` : ''}`).join('\n')
        : '-';

      const alokasiWaktuStr = typeof projection.resolvedAllocatedJP === 'number' && projection.resolvedAllocatedJP > 0
        ? `${projection.resolvedAllocatedJP} JP`
        : '-';

      const infoUmumLines: string[] = [];
      if (isBlankMode) {
        infoUmumLines.push('Alokasi Waktu: ........ JP');
        infoUmumLines.push('Kompetensi Awal: ........................................................');
        infoUmumLines.push('Dimensi Profil Lulusan: ........................................................');
        infoUmumLines.push('Sarana & Prasarana: ........................................................');
        infoUmumLines.push('Model Pembelajaran: ........................................................');
      } else {
        infoUmumLines.push(`Alokasi Waktu: ${alokasiWaktuStr}`);
        infoUmumLines.push(`Kompetensi Awal: ${matchedPlan?.initialCompetency || '-'}`);
        infoUmumLines.push(`Dimensi Profil Lulusan: ${dimensionsStr}`);
        infoUmumLines.push(`Sarana & Prasarana: ${resourcesStr}`);
        if (matchedPlan?.targetStudents && matchedPlan.targetStudents.trim().length > 0) {
          infoUmumLines.push(`Karakteristik/Kebutuhan Belajar Murid: ${matchedPlan.targetStudents.trim()}`);
        }
        infoUmumLines.push(`Model/Praktik Pembelajaran: ${matchedPlan?.learningModel || '-'}`);
      }

      sections.push({
        type: 'heading',
        text: 'I. INFORMASI UMUM',
        level: 1,
      });
      sections.push({
        type: 'paragraph',
        text: infoUmumLines.join('\n'),
      });

      sections.push({
        type: 'heading',
        text: 'II. KOMPONEN INTI',
        level: 1,
      });
      sections.push({
        type: 'paragraph',
        text: isBlankMode
          ? 'Tujuan Pembelajaran: ........................................................................................................................................................\n\nPemahaman Bermakna: ........................................................................................................................................................\n\nPertanyaan Pemantik: ........................................................................................................................................................'
          : `Tujuan Pembelajaran:\n${tpStatements}\n\nPemahaman Bermakna:\n${matchedPlan?.meaningfulUnderstanding || '-'}\n\nPertanyaan Pemantik:\n${matchedPlan?.triggerQuestions && matchedPlan.triggerQuestions.length > 0 ? matchedPlan.triggerQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n') : '-'}`,
      });

      sections.push({
        type: 'heading',
        text: 'III. RENCANA PERTEMUAN',
        level: 1,
      });
      sections.push({
        type: 'paragraph',
        text: '........................................................................................................................',
      });

      sections.push({
        type: 'heading',
        text: 'IV. ASESMEN + KKTP',
        level: 1,
      });
      sections.push({
        type: 'paragraph',
        text: '1. Rencana Asesmen: ........................................................\n2. Kriteria Ketercapaian Tujuan Pembelajaran (KKTP): ........................................................',
      });

      sections.push({
        type: 'heading',
        text: 'V. DIFERENSIASI',
        level: 1,
      });
      sections.push({
        type: 'paragraph',
        text: '........................................................................................................................',
      });

      sections.push({
        type: 'heading',
        text: 'VI. PENGAYAAN/REMEDIAL',
        level: 1,
      });
      sections.push({
        type: 'paragraph',
        text: '1. Rencana Pengayaan: ........................................................\n2. Rencana Remedial: ........................................................',
      });

      sections.push({
        type: 'heading',
        text: 'VII. REFLEKSI',
        level: 1,
      });
      sections.push({
        type: 'paragraph',
        text: '1. Refleksi Guru: ........................................................\n2. Refleksi Murid: ........................................................',
      });
      break;
    }

    case 'KKTP': {
      title = 'Kriteria Ketercapaian Tujuan Pembelajaran (KKTP)';
      subTitle = `${subject} — ${grade} — Semester ${semester}`;
      fileName = `KKTP_${cleanSubject}_${cleanGrade}.pdf`;

      const criteria = context.assessmentCriteria || [];
      const rows = isBlankMode
        ? Array.from({ length: 15 }, (_, idx) => [
            idx + 1,
            `TP ${idx + 1}`,
            '..........................................................................................',
            '....................',
            '..........................................................................................',
          ])
        : criteria.length > 0
        ? criteria.map((c, idx) => {
            const matchingTp = (tp?.items || []).find((t) => t.id === c.tpId);
            const approachLabel = c.approach === 'rubrik' ? 'Rubrik Deskripsi' : c.approach === 'skala_interval' ? 'Interval Nilai' : 'Deskripsi Kriteria';
            return [
              idx + 1,
              matchingTp?.code || `TP ${idx + 1}`,
              matchingTp?.statement || c.description || '-',
              approachLabel,
              c.levels && c.levels.length > 0
                ? c.levels.map((l) => `${l.label || l.level}: ${l.description}`).join(' | ')
                : 'Perlu Bimbingan (0-69) | Cukup (70-79) | Baik (80-89) | Sangat Baik (90-100)',
            ];
          })
        : (tp?.items || []).map((t, idx) => [
            idx + 1,
            t.code || `TP ${idx + 1}`,
            t.statement,
            'Rubrik Deskripsi',
            'Kriteria: Siswa mampu mendemonstrasikan kompetensi dengan tepat dan mandiri (Ketercapaian: Min. Kategori Cukup/75%)',
          ]);

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Kode TP', dataKey: 'code', width: 18, align: 'center' },
          { header: 'Tujuan Pembelajaran', dataKey: 'tp', width: 58 },
          { header: 'Pendekatan', dataKey: 'app', width: 26 },
          { header: 'Kriteria & Rubrik Ketercapaian', dataKey: 'crit', width: 45 },
        ],
        rows,
      });
      break;
    }

    case 'DAFTAR_NILAI': {
      title = 'Buku Daftar Nilai & Rekap Capaian Hasil Belajar';
      subTitle = `${subject} — ${grade} — Semester ${semester}`;
      fileName = `Daftar_Nilai_${cleanSubject}_${cleanGrade}.pdf`;
      orientation = 'landscape';

      const studentList = students || [];
      const resultsList = context.assessmentResults || [];
      const rows = isBlankMode
        ? Array.from({ length: 20 }, (_, idx) => [
            idx + 1,
            '....................',
            '..........................................................................................',
            '....',
            '', '', '', '', '', '',
          ])
        : studentList.map((st, idx) => {
            const studentResults = resultsList.filter((r) => r.studentId === st.id);
            const hasResults = studentResults.length > 0;
            const avgScore = hasResults
              ? Math.round(studentResults.reduce((acc, curr) => acc + curr.score, 0) / studentResults.length)
              : null;
            const tp1Score = studentResults[0]?.score !== undefined ? studentResults[0].score : '-';
            const tp2Score = studentResults[1]?.score !== undefined ? studentResults[1].score : '-';
            const tp3Score = studentResults[2]?.score !== undefined ? studentResults[2].score : '-';
            const sasScore = studentResults[3]?.score !== undefined ? studentResults[3].score : '-';

            return [
              idx + 1,
              st.nisn || '-',
              st.name,
              st.gender || 'L',
              tp1Score,
              tp2Score,
              tp3Score,
              sasScore,
              avgScore !== null ? avgScore : '-',
              avgScore !== null ? (avgScore >= 75 ? 'Tercapai' : 'Perlu Bimbingan') : '-',
            ];
          });

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 10, align: 'center' },
          { header: 'NISN', dataKey: 'nisn', width: 26, align: 'center' },
          { header: 'Nama Peserta Didik', dataKey: 'name', width: 64 },
          { header: 'L/P', dataKey: 'jk', width: 12, align: 'center' },
          { header: 'TP 1', dataKey: 'tp1', width: 17, align: 'center' },
          { header: 'TP 2', dataKey: 'tp2', width: 17, align: 'center' },
          { header: 'TP 3', dataKey: 'tp3', width: 17, align: 'center' },
          { header: 'SAS', dataKey: 'sas', width: 17, align: 'center' },
          { header: 'Nilai Akhir', dataKey: 'na', width: 24, align: 'center' },
          { header: 'Capaian Kompetensi', dataKey: 'cap', width: 48 },
        ],
        rows,
      });
      break;
    }

    case 'DAFTAR_HADIR': {
      title = 'Daftar Presensi & Kehadiran Siswa';
      subTitle = `${subject} — ${grade} — Semester ${semester} — T.A ${academicYear}`;
      fileName = `Daftar_Hadir_${cleanSubject}_${cleanGrade}.pdf`;
      orientation = 'landscape';

      const studentList = students || [];
      const recordsList = context.attendanceRecords || [];
      const rows = isBlankMode
        ? Array.from({ length: 20 }, (_, idx) => [
            idx + 1,
            '....................',
            '..........................................................................................',
            '....',
            '', '', '', '', '', '', '', '', '', '', '', '',
            '', '', '', '',
          ])
        : studentList.map((st, idx) => {
            const studentRecs = recordsList.filter((r) => r.studentId === st.id);
            const sCount = studentRecs.filter((r) => r.status === 'S').length;
            const iCount = studentRecs.filter((r) => r.status === 'I').length;
            const aCount = studentRecs.filter((r) => r.status === 'A').length;
            const total = studentRecs.length;
            const hCount = total > 0 ? studentRecs.filter((r) => r.status === 'H' || r.status === 'D').length : 0;
            const pct = total > 0 ? `${Math.round((hCount / total) * 100)}%` : '-';
            const presenceMarks = total > 0
              ? Array.from({ length: 12 }, (_, pIdx) => studentRecs[pIdx]?.status || '-')
              : Array.from({ length: 12 }, () => '-');

            return [
              idx + 1,
              st.nisn || '-',
              st.name,
              st.gender || 'L',
              ...presenceMarks,
              sCount, iCount, aCount, pct,
            ];
          });

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 9, align: 'center' },
          { header: 'NISN', dataKey: 'nisn', width: 24, align: 'center' },
          { header: 'Nama Peserta Didik', dataKey: 'name', width: 60 },
          { header: 'L/P', dataKey: 'jk', width: 11, align: 'center' },
          { header: 'P1', dataKey: 'p1', width: 9, align: 'center' },
          { header: 'P2', dataKey: 'p2', width: 9, align: 'center' },
          { header: 'P3', dataKey: 'p3', width: 9, align: 'center' },
          { header: 'P4', dataKey: 'p4', width: 9, align: 'center' },
          { header: 'P5', dataKey: 'p5', width: 9, align: 'center' },
          { header: 'P6', dataKey: 'p6', width: 9, align: 'center' },
          { header: 'P7', dataKey: 'p7', width: 9, align: 'center' },
          { header: 'P8', dataKey: 'p8', width: 9, align: 'center' },
          { header: 'P9', dataKey: 'p9', width: 9, align: 'center' },
          { header: 'P10', dataKey: 'p10', width: 9, align: 'center' },
          { header: 'P11', dataKey: 'p11', width: 9, align: 'center' },
          { header: 'P12', dataKey: 'p12', width: 9, align: 'center' },
          { header: 'S', dataKey: 's', width: 8, align: 'center' },
          { header: 'I', dataKey: 'i', width: 8, align: 'center' },
          { header: 'A', dataKey: 'a', width: 8, align: 'center' },
          { header: '%', dataKey: 'pct', width: 16, align: 'center' },
        ],
        rows,
      });
      break;
    }

    case 'KALENDER_AKADEMIK':
    case 'HARI_EFEKTIF': {
      title = type === 'KALENDER_AKADEMIK' ? 'Kalender Pendidikan Satuan Pendidikan' : 'Rincian Hari & Minggu Efektif Belajar';
      subTitle = `${school?.name || 'Sekolah'} — Semester ${semester} — T.A ${academicYear}`;
      fileName = `${type === 'KALENDER_AKADEMIK' ? 'Kalender_Akademik' : 'Hari_Efektif'}_${cleanSubject}_${cleanGrade}.pdf`;

      const days = calendarDays || [];
      const rows = isBlankMode
        ? Array.from({ length: 15 }, (_, idx) => [
            idx + 1,
            '.... / .... / 20...',
            '....................',
            '..........................................................................................',
          ])
        : days.length > 0
        ? days.map((d, idx) => [
            idx + 1,
            d.date,
            calendarDayLabel(d.status),
            d.notes || '-',
          ])
        : [
            [1, '—', '—', 'Belum ada agenda kalender akademik yang ditetapkan'],
          ];

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Tanggal', dataKey: 'date', width: 28 },
          { header: 'Status Agenda', dataKey: 'status', width: 34 },
          { header: 'Uraian Kegiatan / Agenda Sekolah', dataKey: 'notes', width: 85 },
        ],
        rows,
      });
      break;
    }

    case 'ALOKASI_WAKTU': {
      const isK13 = academicSetting?.curriculumType === 'K13' || academicSetting?.curriculum === 'Kurikulum 2013';

      if (isK13) {
        title = 'Distribusi Alokasi Waktu Pembelajaran';
        subTitle = `${subject} — ${grade} — Semester ${semester}`;
        fileName = `Alokasi_Waktu_${cleanSubject}_${cleanGrade}.pdf`;

        const k13Rows = buildK13AlokasiWaktuRows(k13Analysis?.items || [], timeAllocations);
        const totalAllocatedJP = k13Rows.reduce((sum, r) => sum + r.allocatedJP, 0);

        const weeklyJP =
          academicSetting?.subjectWeeklyJP ||
          context.calendar?.jpPerWeek ||
          academicSetting?.totalHoursPerWeek ||
          null;

        extraIdentityRows = [
          ['Tahun Ajaran / Semester', `: ${academicYear} / ${semester}`],
          ['Beban JP Intrakurikuler per Minggu', `: ${weeklyJP !== null ? `${weeklyJP} JP / Minggu` : '-'}`],
          ['Total Alokasi Pembelajaran Terdata', `: ${totalAllocatedJP} Jam Pelajaran (JP)`],
        ];

        const rows = isBlankMode
          ? Array.from({ length: 15 }, (_, idx) => [
              idx + 1,
              `KD ${idx + 1}`,
              '..........................................................................................',
              '...............',
              '..... JP',
              '....................',
            ])
          : k13Rows.length > 0
          ? k13Rows.map((r, idx) => [
              idx + 1,
              r.kdCode,
              r.materi,
              r.weekDisplay,
              `${r.allocatedJP} JP`,
              '-',
            ])
          : [[1, '—', 'Belum ada analisis KD yang disusun.', '—', '—', '—']];

        if (!isBlankMode && k13Rows.length > 0) {
          rows.push([
            'TOTAL',
            '',
            'Total Alokasi Waktu Pembelajaran Terjadwal',
            '-',
            `${totalAllocatedJP} JP`,
            '-',
          ]);
        }

        sections.push({
          type: 'table',
          columns: [
            { header: 'No', dataKey: 'no', width: 8, align: 'center' },
            { header: 'Kode KD', dataKey: 'code', width: 20, align: 'center' },
            { header: 'Lingkup Materi / Topik', dataKey: 'topic', width: 60 },
            { header: 'Alokasi Pekan', dataKey: 'wks', width: 20, align: 'center' },
            { header: 'Jam Pelajaran', dataKey: 'jp', width: 18, align: 'center' },
            { header: 'Distribusi Waktu Mengajar', dataKey: 'dist', width: 29 },
          ],
          rows,
        });

        if (!isBlankMode) {
          sections.push({
            type: 'heading',
            text: 'Ringkasan Alokasi Waktu Pembelajaran Semester',
            level: 2,
          });
          sections.push({
            type: 'paragraph',
            text: [
              `• Beban JP Intrakurikuler per Minggu: ${weeklyJP !== null ? `${weeklyJP} JP / Minggu` : '—'}`,
              `• Total Alokasi Pembelajaran Terdata: ${totalAllocatedJP} JP`,
              `• Keterangan Pelaksanaan: Alokasi terjadwal sesuai silabus KD semester aktif.`,
            ].join('\n'),
          });
        }
        break;
      }

      const projection = buildPromesProjection(context);
      const canonical = resolveMerdekaCanonicalTimeProjection(context);

      if (!isBlankMode && !canonical.isReady) {
        throw new Error(
          canonical.errors.length
            ? `Distribusi Alokasi Waktu belum dapat dibuat karena: ${canonical.errors.join(' ')}`
            : 'Distribusi Alokasi Waktu belum dapat dibuat karena prasyarat semester aktif belum lengkap.'
        );
      }

      const activeSemesterNum =
        academicSetting?.semester?.includes('1') ||
        academicSetting?.semester?.toLowerCase().includes('ganjil')
          ? 1
          : 2;

      const merdekaMeetings = canonical.rows
        .filter((r) => r.semester === activeSemesterNum)
        .sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          if (a.unitOrder !== b.unitOrder) return a.unitOrder - b.unitOrder;
          return a.meetingOrder - b.meetingOrder;
        });

      const totalAllocatedJP = merdekaMeetings.reduce(
        (sum, row) => sum + row.jp,
        0
      );

      const weeklyJpText =
        projection.actualScheduledWeeklyJP !== null
          ? `${projection.actualScheduledWeeklyJP} JP / Minggu`
          : '-';
      const availableJpText =
        projection.availableJP !== null ? `${projection.availableJP} Jam Pelajaran` : '-';
      const remainingJpText =
        projection.remainingJP !== null ? `${projection.remainingJP} JP` : '-';
      const statusDescription = formatAllocationStatusIndonesian(projection.remainingJP);

      extraIdentityRows = [
        ['Tahun Ajaran / Semester', `: ${academicYear} / ${activeSemesterNum}`],
        ['Beban JP Intrakurikuler per Minggu', `: ${weeklyJpText}`],
        ['Alokasi JP Semester', `: ${availableJpText}`],
        ['Total Alokasi Pembelajaran Terdata', `: ${totalAllocatedJP} Jam Pelajaran (JP)`],
        ['Selisih Alokasi JP', `: ${remainingJpText} (${statusDescription})`],
      ];

      title = 'Distribusi Alokasi Waktu Pembelajaran';
      subTitle = `${subject} — ${grade} — Semester ${activeSemesterNum} | Total ${totalAllocatedJP} JP`;
      fileName = `Alokasi_Waktu_${cleanSubject}_${cleanGrade}.pdf`;

      const rows = isBlankMode
        ? Array.from({ length: 15 }, (_, idx) => [
            idx + 1,
            `Pertemuan ${idx + 1}`,
            '..........................................................................................',
            '..... JP',
            '....................',
          ])
        : merdekaMeetings.length > 0
        ? merdekaMeetings.map((r, idx) => {
            const materialText =
              r.materials.map((m) => m.title).filter(Boolean).join(', ') || '—';
            const dateWeekText = `${formatDateIndonesian(r.date)} • Pekan ${r.weekIndex}`;

            return [
              idx + 1,
              `${r.unitTitle} — ${r.meetingTitle}`,
              materialText,
              `${r.jp} JP`,
              dateWeekText,
            ];
          })
        : [[1, '—', 'Belum ada alokasi waktu yang disusun.', '—', '—']];

      if (!isBlankMode && merdekaMeetings.length > 0) {
        rows.push([
          'TOTAL',
          '',
          'Total Alokasi Waktu Pembelajaran Terjadwal',
          `${totalAllocatedJP} JP`,
          '-',
        ]);
      }

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Unit/Bab / Pertemuan', dataKey: 'meeting', width: 42 },
          { header: 'Materi Pembelajaran', dataKey: 'mat', width: 58 },
          { header: 'Alokasi JP', dataKey: 'jp', width: 18, align: 'center' },
          { header: 'Tanggal / Pekan', dataKey: 'dateWeek', width: 29, align: 'center' },
        ],
        rows,
      });

      if (!isBlankMode) {
        sections.push({
          type: 'heading',
          text: 'Ringkasan Alokasi Waktu Pembelajaran Semester',
          level: 2,
        });
        sections.push({
          type: 'paragraph',
          text: [
            `• Beban JP Intrakurikuler per Minggu: ${weeklyJpText}`,
            `• Alokasi JP Semester: ${projection.availableJP !== null ? `${projection.availableJP} JP` : '—'}`,
            `• Total Alokasi Pembelajaran Terdata: ${totalAllocatedJP} JP`,
            `• Selisih Alokasi JP: ${remainingJpText} (${statusDescription})`,
          ].join('\n'),
        });
      }
      break;
    }

    case 'JURNAL': {
      const projection = buildJurnalProjection(context);
      if (!projection.isReady) throw new Error(projection.reasons.join('; ') + ' Gunakan format kosong.');
      title = isBlankMode ? 'Jurnal Harian Pembelajaran (Format Kosong)' : 'Jurnal Harian Pembelajaran';
      subTitle = subject + ' — ' + grade + ' — Semester ' + semester;
      fileName = 'Jurnal_Mengajar_' + cleanSubject + '_' + cleanGrade + '.pdf';
      orientation = 'landscape';
      sections.push({ type: 'table',
        columns: JURNAL_COLUMNS.map((header, index) => ({ header, dataKey: 'j'+index, width: JURNAL_WIDTHS[index]*2.52, align: index === 0 ? 'center' as const : 'left' as const })),
        rows: jurnalTableRows(projection, isBlankMode),
      });
      break;
    }

    case 'REMEDIAL_PENGAYAAN': {
      title = 'Program Tindak Lanjut Remedial dan Pengayaan';
      subTitle = `${subject} — ${grade} — Semester ${semester}`;
      fileName = `Remedial_Pengayaan_${cleanSubject}_${cleanGrade}.pdf`;

      const remedials = context.remedials || [];
      const rows = isBlankMode
        ? Array.from({ length: 15 }, (_, idx) => [
            idx + 1,
            '..........................................................................................',
            '..........',
            '....................',
            '..........................................................................................',
            '..........',
            '..........',
          ])
        : remedials.length > 0
        ? remedials.map((r, idx) => {
            const student = (context.students || []).find((s) => s.id === r.studentId);
            const matchingTp = (tp?.items || []).find((t) => t.id === r.tpId);
            return [
              idx + 1,
              student?.name || '-',
              matchingTp?.code || '-',
              r.reason || 'Perlu Bimbingan',
              r.intervention || 'Bimbingan Khusus / Penugasan Terbimbing',
              r.reassessmentScore != null ? r.reassessmentScore : '-',
              r.status === 'completed' ? 'Tuntas' : 'Berjalan',
            ];
          })
        : [
            [1, '—', '—', 'Belum ada data remedial', '—', '—', '—'],
          ];

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Nama Siswa', dataKey: 'name', width: 38 },
          { header: 'Kode TP', dataKey: 'code', width: 16, align: 'center' },
          { header: 'Kondisi Awal', dataKey: 'init', width: 24, align: 'center' },
          { header: 'Bentuk Kegiatan Tindak Lanjut', dataKey: 'act', width: 38 },
          { header: 'Nilai Akhir', dataKey: 'fin', width: 15, align: 'center' },
          { header: 'Keterangan', dataKey: 'stat', width: 16, align: 'center' },
        ],
        rows,
      });
      break;
    }

    case 'ANALISIS_SKL_KI_KD': {
      title = 'Analisis Standar Kompetensi Lulusan (SKL), KI, dan KD';
      subTitle = `${subject} — ${grade} — Kurikulum 2013 (K13)`;
      fileName = `Analisis_SKL_KI_KD_${cleanSubject}_${cleanGrade}.pdf`;

      const rows = isBlankMode
        ? Array.from({ length: 15 }, (_, idx) => [
            idx + 1,
            '....................',
            '....................',
            '....................',
            '..........................................................................................',
            '....................',
          ])
        : (context.k13Analysis?.items || []).map((it, idx) => [
            idx + 1,
            it.skl || 'Sikap / Pengetahuan',
            it.ki || `KI-${idx + 1}`,
            it.kd || `KD 3.${idx + 1}`,
            it.indikator || '-',
            it.materi || '-',
          ]);

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Domain SKL', dataKey: 'skl', width: 24 },
          { header: 'Kode KI', dataKey: 'ki', width: 16, align: 'center' },
          { header: 'Kode KD', dataKey: 'kd', width: 18, align: 'center' },
          { header: 'Indikator Pencapaian (IPK)', dataKey: 'ipk', width: 61 },
          { header: 'Lingkup Materi', dataKey: 'mat', width: 28 },
        ],
        rows,
      });
      break;
    }

    case 'PENETAPAN_KKM': {
      title = 'Penetapan Kriteria Ketuntasan Minimal (KKM)';
      subTitle = `${subject} — ${grade} — Kurikulum 2013 (K13)`;
      fileName = `Penetapan_KKM_${cleanSubject}_${cleanGrade}.pdf`;

      const rows = isBlankMode
        ? Array.from({ length: 15 }, (_, idx) => [
            idx + 1,
            `KD 3.${idx + 1}`,
            '..........................................................................................',
            '.......... %',
            '.......... %',
            '.......... %',
            '.......... %',
          ])
        : (context.k13KKM?.items || []).map((it, idx) => [
            idx + 1,
            it.kd || `KD 3.${idx + 1}`,
            it.indikator || '-',
            it.kompleksitas != null ? `${it.kompleksitas}%` : '-',
            it.dayaDukung != null ? `${it.dayaDukung}%` : '-',
            it.intake != null ? `${it.intake}%` : '-',
            it.kkmIndikator != null ? `${it.kkmIndikator}%` : '-',
          ]);

      sections.push({
        type: 'table',
        columns: [
          { header: 'No', dataKey: 'no', width: 8, align: 'center' },
          { header: 'Kode KD', dataKey: 'kd', width: 18, align: 'center' },
          { header: 'Indikator Pencapaian Kompetensi', dataKey: 'ind', width: 61 },
          { header: 'Kompleksitas', dataKey: 'c1', width: 17, align: 'center' },
          { header: 'Daya Dukung', dataKey: 'c2', width: 17, align: 'center' },
          { header: 'Intake Siswa', dataKey: 'c3', width: 17, align: 'center' },
          { header: 'Nilai KKM', dataKey: 'kkm', width: 17, align: 'center' },
        ],
        rows,
      });
      break;
    }

    default: {
      const typeStr = String(type);
      title = `Dokumen ${typeStr.replace(/_/g, ' ')}`;
      subTitle = `${subject} — ${grade}`;
      fileName = `Dokumen_${typeStr}_${cleanSubject}_${cleanGrade}.pdf`;

      sections.push({
        type: 'paragraph',
        text: `Dokumen resmi administrasi guru: ${typeStr.replace(/_/g, ' ')}. Data terlampir sesuai dengan kurikulum dan profil pengajar.`,
      });
      break;
    }
  }

  if (isBlankMode) {
    title += ' (FORMAT KOSONG)';
    subTitle += ' — Format Kosong Siap Cetak / Tulis Manual';
    fileName = `[Format_Kosong]_${fileName}`;
  }

  const styleProfile: PdfStyleProfile = 'FORMAL_NEUTRAL';
  const dateString = formatOfficialDate(school, context.documentDate);

  const isAnnualScopeDoc =
    type === 'CP' ||
    type === 'TP' ||
    type === 'ATP' ||
    type === 'PEMETAAN_ATP_UNIT' ||
    type === 'PROTA' ||
    type === 'ANALISIS_CP_TP';

  const builder = buildPdfFromOptions({
    orientation,
    styleProfile,
    title,
    subTitle,
    school,
    profile,
    academicSetting,
    extraIdentityRows,
    sections,
    showSignature: true,
    isBlankMode,
    dateString,
    scope: isAnnualScopeDoc ? 'YEAR' : 'SEMESTER',
  });

  const blob = builder.getBlob();
  if (type === 'MODUL_AJAR') recordModulAjarExportDiagnostic(context, buildModulAjarProjection(context), snapshot, 'pdf');
  return { blob, fileName, title, snapshot };
}
