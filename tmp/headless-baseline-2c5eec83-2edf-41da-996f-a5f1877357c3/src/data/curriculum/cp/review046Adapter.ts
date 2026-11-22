import { MasterCPEntry, CPElement } from './types';
import { isReligionSubject } from '../subjects';
import type { CurriculumPhase, SchoolLevel } from '../types';

export const CP046_SUBJECT_CODES: Record<string, string> = {
  "I.1": "PAI",
  "I.2": "PAK",
  "I.3": "PKAT",
  "I.4": "PHINDU",
  "I.5": "PBUDDHA",
  "I.6": "PKHONGHUCU",
  "II": "PANCASILA",
  "III.1": "BINDO",
  "III.2": "BINDO_LANJUT",
  "IV.1": "MAT",
  "IV.2": "MAT_LANJUT",
  "V.1": "BING",
  "V.2": "BING_LANJUT",
  "VI": "IPAS",
  "VII": "IPA",
  "VIII": "FISIKA",
  "IX": "KIMIA",
  "X": "BIOLOGI",
  "XI": "INFORMATIKA",
  "XII": "IPS",
  "XIII.1": "SEJARAH",
  "XIII.2": "SEJARAH_LANJUT",
  "XIV": "GEOGRAFI",
  "XV": "EKONOMI",
  "XVI": "SOSIOLOGI",
  "XVII": "ANTROPOLOGI",
  "XVIII.1": "SENI_MUSIK",
  "XVIII.2": "SENI_RUPA",
  "XVIII.3": "SENI_TARI",
  "XVIII.4": "SENI_TEATER",
  "XIX.1": "PRAKARYA_BUDI_DAYA",
  "XIX.2": "PRAKARYA_KERAJINAN",
  "XIX.3": "PRAKARYA_PENGOLAHAN",
  "XIX.4": "PRAKARYA_REKAYASA",
  "XX.1": "PKWU_BUDI_DAYA",
  "XX.2": "PKWU_KERAJINAN",
  "XX.3": "PKWU_PENGOLAHAN",
  "XX.4": "PKWU_REKAYASA",
  "XXI": "PJOK",
  "XXII": "B_ARAB",
  "XXIII": "B_JEPANG",
  "XXIV": "B_JERMAN",
  "XXV": "B_KOREA",
  "XXVI": "B_MANDARIN",
  "XXVII": "B_PRANCIS",
  "XXVIII": "CODING_AI"
};
export interface ReviewElement { id: string; nomor: string; nama: string; teks: string; subelemen?: ReviewElement[] }
export interface ReviewRecord { id: string; kode_bagian: string; mata_pelajaran: string; fase: string; kelas: number[]; sumber_halaman_pdf: { awal: number; akhir_terdeteksi: number }; elemen: ReviewElement[]; teks_sumber_ekstraksi: string; status_verifikasi: string }
export interface ReviewDocument { schema_version: string; status: string; sumber: { regulasi: string; lampiran: string; file: string; sha256_pdf: string }; records: ReviewRecord[] }

/** Only remove an exact leading label followed by whitespace; preserve raw text separately. */
export function separateElementLabel(name: string, text: string): string {
  return text.startsWith(name) && /^\s/.test(text.slice(name.length)) ? text.slice(name.length).trimStart() : text;
}
function adaptElement(el: ReviewElement): CPElement & { id: string } {
  const children = (el.subelemen || []).map(adaptElement);
  return { id: el.id, number: el.nomor, name: el.nama, sourceText: el.teks,
    content: children.length ? children.map(child => child.name + '\n' + child.content).join('\n\n') : separateElementLabel(el.nama, el.teks),
    subelements: children };
}
export function adaptCP046Review(document: ReviewDocument, level: SchoolLevel): MasterCPEntry[] {
  return document.records.map(record => {
    const code = CP046_SUBJECT_CODES[record.kode_bagian];
    if (!code || !(level === 'SD' ? ['A', 'B', 'C'].includes(record.fase) : level === 'SMP' ? record.fase === 'D' : level === 'SMA' && ['E', 'F'].includes(record.fase))) throw new Error('Invalid CP046 identity: ' + record.id);
    return { id: record.id, subjectCode: code, phase: record.fase as CurriculumPhase, level,
      generalDescription: '', elements: record.elemen.map(adaptElement),
      regulationSourceId: 'DEC-BSKAP-046-2025', implementationFromAcademicYear: '2025/2026',
      implementationUntilAcademicYear: isReligionSubject(code) ? '2025/2026' : null,
      verificationStatus: level === 'SD' && record.status_verifikasi === 'VERIFIED_SOURCE_MATCH' ? 'VERIFIED' : 'UNVERIFIED',
      notes: level === 'SD' && record.status_verifikasi === 'VERIFIED_SOURCE_MATCH'
        ? 'Teks, elemen/subelemen, fase dan halaman dicocokkan terhadap PDF sumber. ' + document.status + '. Agama dibatasi sesuai registry 020/2026; pilih sumber secara eksplisit tanpa mengganti CP guru tersimpan.'
        : 'REVIEW: ' + document.status + '. Agama dibatasi sesuai registry 020/2026; masa implementasi perlu review dokumen keputusan.',
      sourceReview: { schemaVersion: document.schema_version, status: document.status, regulation: document.sumber.regulasi,
        attachment: document.sumber.lampiran, file: document.sumber.file, pdfSha256: document.sumber.sha256_pdf,
        section: record.kode_bagian, subjectName: record.mata_pelajaran, grades: [...record.kelas],
        pages: { ...record.sumber_halaman_pdf }, extractedText: record.teks_sumber_ekstraksi, recordStatus: record.status_verifikasi },
      evidence: [{ regulationId: 'DEC-BSKAP-046-2025', sourceUrl: 'https://kurikulum.kemendikdasmen.go.id/file/1753929861_manage_file.pdf',
        locator: { attachment: document.sumber.lampiran, page: record.sumber_halaman_pdf.awal, section: record.kode_bagian,
          note: 'PDF ' + record.sumber_halaman_pdf.awal + '–' + record.sumber_halaman_pdf.akhir_terdeteksi } }],
    };
  });
}
