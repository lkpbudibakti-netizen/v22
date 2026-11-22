import type { MasterCPEntry } from './types';

/** Affect source selection only; never mutate historical records or teacher CP. */
export function getCPSourceAuditIssue(entry: MasterCPEntry): string | undefined {
  if(entry.id === 'cp-sd-fase-b-coding-ai' && entry.subjectCode === 'CODING_AI' && entry.level === 'SD' && entry.phase === 'B') {
    return 'UNRESOLVED: teks Coding & AI Fase B bawaan tidak cocok dengan CP resmi. Permendikdasmen 13/2025 mengatur penyediaan mapel mulai kelas V; CP 046/2025 Lampiran II memuat Fase C (PDF 342–343), bukan Fase B. Catatan lama dipertahankan untuk data historis; gunakan CP manual dengan sumber yang dapat dibuktikan.';
  }
}
