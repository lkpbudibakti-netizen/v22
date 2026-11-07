import type { DocumentGenerationContext } from './types';
import { buildProtaProjection } from './protaProjection';

export function annualJPNotes(p: { availableAnnualJP?: number | null; totalAllocatedJP: number; officialAnnualJP: number | null }): string {
  const lines = [
    `Kapasitas kalender tahunan: ${p.availableAnnualJP ?? 'belum terverifikasi'} JP.`,
    `Alokasi aktual tahunan guru: ${p.totalAllocatedJP} JP.`,
    `Acuan regulasi intrakurikuler tahunan: ${p.officialAnnualJP ?? 'belum terverifikasi'} JP.`,
  ];
  if (p.officialAnnualJP !== null && p.totalAllocatedJP !== p.officialAnnualJP) {
    const delta = p.totalAllocatedJP - p.officialAnnualJP;
    lines.push(`Alokasi aktual ${delta > 0 ? 'melebihi' : 'di bawah'} acuan regulasi sebesar ${Math.abs(delta)} JP (${p.totalAllocatedJP} ${delta > 0 ? '>' : '<'} ${p.officialAnnualJP} JP). Selisih ini tidak mengubah alokasi guru dan tidak dibagi otomatis antarsemester.`);
  }
  return lines.join('\n');
}

export function promesAnnualJPNotes(context: DocumentGenerationContext): string {
  if (context.documentMode === 'blank') return '';
  const annual = buildProtaProjection(context);
  return annual.isReady ? annualJPNotes(annual) : 'Perbandingan alokasi aktual dengan acuan regulasi tahunan belum dapat diverifikasi dari data tahunan. Acuan tahunan tidak dibagi otomatis antarsemester.';
}
