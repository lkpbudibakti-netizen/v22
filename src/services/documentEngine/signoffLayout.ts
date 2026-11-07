import { Paragraph, Table, TableCell, TableRow, TextRun, WidthType, BorderStyle } from 'docx';

export interface PrintSignoff {
  contextLabel?: string;
  locationAndDate: string;
  principalTitle: string;
  principalName: string;
  principalNip?: string;
  teacherTitle: string;
  teacherName: string;
  teacherNip?: string;
  isBlankMode: boolean;
}

export function signoffColumns(s: PrintSignoff): string[][] {
  const name = (value: string) => s.isBlankMode ? '(........................)' : value || '(........................)';
  const nip = (value?: string) => `NIP. ${!s.isBlankMode && value ? value : '....................'}`;
  return [
    ['Mengetahui,', s.principalTitle || 'Kepala Sekolah', name(s.principalName), nip(s.principalNip)],
    [s.locationAndDate || '....................., ....................', s.teacherTitle || 'Guru Mata Pelajaran', name(s.teacherName), nip(s.teacherNip)],
  ];
}

/** One in-flow, non-splitting row. Signature space uses text lines, never row height. */
export function createPrintSignoff(s: PrintSignoff, font = 'Times New Roman', size = 24): (Paragraph | Table)[] {
  const none = { style: BorderStyle.NONE };
  return [new Paragraph({ keepNext: true, keepLines: true, spacing: { before: 160, after: 80 }, children: [new TextRun({ text: 'Pengesahan: ' + (s.contextLabel || 'Administrasi pembelajaran'), font, size: size - 2 })] }), new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [new TableRow({
      cantSplit: true,
      children: signoffColumns(s).map(lines => new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        margins: { top: 160, bottom: 40, left: 80, right: 160 },
        children: [
          ...lines.flatMap((text, index) => [
            ...(index === 2 ? [new Paragraph({ keepNext: true, keepLines: true, children: [new TextRun({ break: 3, font, size })] })] : []),
            new Paragraph({ keepNext: index < lines.length - 1, keepLines: true, spacing: { after: 40 }, children: [new TextRun({ text, font, size, bold: index === 2, underline: index === 2 ? {} : undefined })] }),
          ]),
        ],
      })),
    })],
  })];
}
