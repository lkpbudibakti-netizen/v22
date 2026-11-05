import type { PromesProjection } from './promesProjection';

function formatAllocatedWeeks(allocations: Record<number, number>): string {
  const weeks = Object.entries(allocations)
    .filter(([, jp]) => Number.isFinite(jp) && jp > 0)
    .map(([week]) => Number(week))
    .filter(week => Number.isInteger(week) && week > 0).sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < weeks.length; index++) {
    const start = weeks[index];
    let end = start;
    while (index + 1 < weeks.length && weeks[index + 1] === end + 1) end = weeks[++index];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join(', ') || '-';
}

export function formatAllocationStatusIndonesian(
  statusOrRemaining: string | number | null | undefined,
  remainingJP?: number | null
): string {
  if (typeof statusOrRemaining === 'number') {
    if (statusOrRemaining === 0) return 'Alokasi sesuai';
    if (statusOrRemaining < 0) return 'Alokasi melebihi ketentuan';
    if (statusOrRemaining > 0) return 'Alokasi belum terpenuhi';
    return '-';
  }

  if (remainingJP !== undefined && remainingJP !== null) {
    if (remainingJP === 0) return 'Alokasi sesuai';
    if (remainingJP < 0) return 'Alokasi melebihi ketentuan';
    if (remainingJP > 0) return 'Alokasi belum terpenuhi';
  }

  if (statusOrRemaining === 'BALANCED') return 'Alokasi sesuai';
  if (statusOrRemaining === 'OVER_ALLOCATED') return 'Alokasi melebihi ketentuan';
  if (statusOrRemaining === 'UNDER_ALLOCATED') return 'Alokasi belum terpenuhi';

  return '-';
}

/** Formatting only: all allocation and semester scope come from buildPromesProjection. */
export function buildPromesPresentation(projection: PromesProjection, blank = false) {
  const months = projection.monthHeaders.map(month => month.monthName);
  const sourceRows = [...projection.rows, ...projection.assessmentRows, ...projection.reserveRows];
  const isK13 = projection.curriculumType === 'K13';
  const headers = ['No', ...(isK13 ? ['Kompetensi Dasar (KD)', 'Indikator/Materi'] : ['Unit/Bab', 'TP', 'Materi']), 'Alokasi JP', 'Pekan', ...months];
  const widths = [3, ...(isK13 ? [13, 38] : [13, 25, 13]), 7, 7, ...months.map(() => 32 / months.length)];
  const jpIndex = isK13 ? 3 : 4;
  const alignments = headers.map((_, index): 'left' | 'center' => index === 0 || index >= jpIndex ? 'center' : 'left');
  const rows = blank
    ? Array.from({ length: 15 }, (_, index) => [String(index + 1), ...Array(isK13 ? 2 : 3).fill('........'), '.... JP', '....', ...months.map(() => '-')])
    : sourceRows.map((row, index) => [
        String(index + 1),
        ...(isK13
          ? [row.tpCode || '-', [row.tpStatement, row.materialScope].filter(Boolean).join('\n') || '-']
          : [row.unitTitle || row.unitId || '-', [row.tpCode, row.tpStatement].filter(Boolean).join('\n') || '-', row.materialScope || '-']),
        `${row.allocatedJP} JP`, formatAllocatedWeeks(row.weekAllocations),
        ...months.map(month => row.monthlyJP[month] == null || row.monthlyJP[month] === 0 ? '-' : String(row.monthlyJP[month])),
      ]);
  const totalJP = sourceRows.reduce((sum, row) => sum + row.allocatedJP, 0);
  const monthlyTotals = months.map(month => sourceRows.reduce((sum, row) => sum + (row.monthlyJP[month] ?? 0), 0));
  const remainingJP = projection.availableJP === null ? null : projection.availableJP - totalJP;
  const status = remainingJP === null ? '-' : remainingJP < 0 ? 'OVER_ALLOCATED' : remainingJP > 0 ? 'UNDER_ALLOCATED' : 'BALANCED';
  const statusLabel = formatAllocationStatusIndonesian(status, remainingJP);
  const summaryRows = [
    ['-', '-', 'TOTAL JP SEMESTER', '-', blank ? '-' : `${totalJP} JP`, '-', ...monthlyTotals.map(total => blank ? '-' : String(total))],
    ['-', '-', 'ALOKASI JP SEMESTER', '-', blank || projection.availableJP === null ? '-' : `${projection.availableJP} JP`, '-', ...months.map(() => '-')],
    ['-', '-', 'SELISIH ALOKASI JP', '-', blank || remainingJP === null ? '-' : `${remainingJP} JP`, '-', ...months.map(() => '-')],
  ].map(row => isK13 ? row.filter((_, index) => index !== 3) : row);
  const notes = [
    'Angka pada kolom bulan menunjukkan Jam Pelajaran (JP) intrakurikuler tatap muka yang telah dijadwalkan guru.',
    'Item tanpa alokasi bulan diberi tanda strip (-) yang berarti belum dijadwalkan pada kalender aktif.',
    'Selisih bertanda negatif menunjukkan alokasi melebihi target alokasi JP semester.',
  ].join('\n');
  return { headers, widths, alignments, rows, summaryRows, notes, totalJP, monthlyTotals, remainingJP, status, statusLabel };
}
