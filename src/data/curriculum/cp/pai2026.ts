import type { CurriculumPhase, SchoolLevel } from '../types';
import type { MasterCPEntry } from './types';

// Transcribed from the scanned decree, PDF/printed pages 6–9, checked visually
// against the original. The guide is corroboration, not the text authority.
// Provenance, PDF hashes and editorial differences: docs/pai-cp-2026-integration.md.
const phases: Array<{
  phase: CurriculumPhase;
  level: SchoolLevel;
  pages: [number, number];
  contents: [string, string, string, string, string];
}> = [
  {
    phase: 'A', level: 'SD', pages: [6, 7],
    contents: [
      'Membaca dan membedakan huruf hijaiah berharakat, huruf hijaiah bersambung; menghafal Surah al-Fātiḥah, beberapa surah pendek Al-Qur’an, dan hadis tentang kebersihan.',
      'Menjelaskan dan meyakini rukun iman, iman kepada Allah Swt., beberapa asmaulhusna, dan iman kepada malaikat.',
      'Menerapkan akhlak terhadap Allah Swt. dengan menyucikan dan memuji-Nya, dan akhlak terhadap diri sendiri.',
      'Menerapkan rukun Islam, syahadatain, tata cara bersuci, salat fardu, zikir dan berdoa setelah salat.',
      'Menceritakan kisah keteladanan beberapa nabi dan rasul.',
    ],
  },
  {
    phase: 'B', level: 'SD', pages: [7, 7],
    contents: [
      'Membaca, menulis, dan membedakan huruf hijaiah bersambung; menghafal dan menjelaskan beberapa surah pendek, hadis tentang kewajiban salat dan menjaga hubungan baik dengan sesama.',
      'Menjelaskan dan meyakini sifat-sifat Allah Swt., iman kepada kitab-kitab Allah Swt., beberapa asmaulhusna, dan iman kepada rasul-rasul Allah Swt.',
      'Menerapkan akhlak terhadap Allah Swt. dengan berbaik sangka kepada-Nya, akhlak terhadap orang tua, keluarga, dan guru.',
      'Menerapkan azan dan ikamah, salat jumat dan salat sunah; menjelaskan balig dan tanggung jawab yang menyertainya (taklīf).',
      'Menceritakan dan menjelaskan kisah Nabi Muhammad saw. sebelum dan sesudah menjadi rasul periode Makkah.',
    ],
  },
  {
    phase: 'C', level: 'SD', pages: [7, 8],
    contents: [
      'Membaca, menulis, dan membedakan huruf hijaiah bersambung; menjelaskan beberapa surah pendek dan hadis tentang berbuat baik kepada orang tua, guru, dan teman.',
      'Menjelaskan dan meyakini beberapa asmaulhusna, iman kepada hari akhir, iman kepada qadā’ dan qadar.',
      'Menerapkan akhlak terhadap Allah Swt. dengan berdoa dan bertawakal kepada-Nya, akhlak terhadap teman, tetangga, non-muslim, hewan, dan tumbuhan.',
      'Menerapkan puasa wajib dan sunah, makanan minuman yang halal dan haram, zakat, infak, sedekah, dan wakaf.',
      'Menceritakan dan menjelaskan kisah Nabi Muhammad saw. periode Madinah dan khulafaurasyidin.',
    ],
  },
  {
    phase: 'D', level: 'SMP', pages: [8, 8],
    contents: [
      'Membaca, menghafal, menulis, dan menjelaskan ayat Al-Qur’an tentang pentingnya iman, takwa, toleransi, cinta tanah air, semangat keilmuan, dan sabar dalam menghadapi musibah dan ujian beserta hadis terkait.',
      'Meyakini dan merefleksikan rukun iman dan hal-hal yang dapat meneguhkan iman.',
      'Menerapkan makna ikhlas, bersyukur kepada Allah Swt., cinta rasul, cinta ilmu, cinta lingkungan, cinta diri sendiri dan sesama.',
      'Menerapkan ketentuan sujud di luar rukun salat, rukhsah dalam ibadah, kewajiban terhadap jenazah, haji dan umrah, penyembelihan hewan, kurban, akikah, dan wakaf.',
      'Merefleksikan sejarah dan peran Kekhalifahan Islam pasca Khulafaur Rasyidin dan sejarah masuknya Islam di Indonesia.',
    ],
  },
  {
    phase: 'E', level: 'SMA', pages: [8, 8],
    contents: [
      'Membaca, menghafal, menulis, dan menganalisis ayat Al-Qur’an tentang perintah berlomba-lomba dalam kebaikan, larangan pergaulan bebas, dan zina beserta hadis terkait.',
      'Meyakini dan merefleksikan beberapa cabang iman (syu‘ab al-īmān).',
      'Menerapkan manfaat menghindari penyakit hati.',
      'Menerapkan dan merefleksikan sumber hukum Islam, pentingnya menjaga lima prinsip dasar hukum Islam (al-kulliyāt al-khamsah), ekonomi syariah, dan wakaf.',
      'Merefleksikan peran tokoh ulama dalam penyebaran Islam di Indonesia.',
    ],
  },
  {
    phase: 'F', level: 'SMA', pages: [9, 9],
    contents: [
      'Membaca, menghafal, menulis, dan merefleksikan ayat Al-Qur’an tentang pentingnya berpikir kritis, ilmu pengetahuan dan teknologi, memelihara kehidupan manusia, dan moderasi beragama beserta hadis terkait.',
      'Meyakini dan merefleksikan beberapa cabang iman (syu‘ab al-īmān), keterkaitan antara iman, Islam, dan ihsan.',
      'Menerapkan manfaat menghindari penyakit sosial; merefleksikan adab bermasyarakat dan etika digital dalam Islam.',
      'Menerapkan dan merefleksikan ketentuan khotbah, tablig dan dakwah, ekonomi syariah, wakaf, munakahat, dan mawaris.',
      'Merefleksikan peran tokoh ulama Indonesia dalam perkembangan peradaban Islam di dunia dan peran organisasi-organisasi Islam di Indonesia.',
    ],
  },
];

const elementNames = ['Al-Qur’an Hadis', 'Akidah', 'Akhlak', 'Fikih', 'Sejarah Peradaban Islam'];

export const PAI_2026_CP_ENTRIES: MasterCPEntry[] = phases.map((record, index) => ({
  id: `cp26-${record.level.toLowerCase()}-fase-${record.phase.toLowerCase()}-pai`,
  subjectCode: 'PAI',
  phase: record.phase,
  level: record.level,
  regulationSourceId: 'DEC-BKPDM-020-2026',
  implementationFromAcademicYear: '2026/2027',
  verificationStatus: 'VERIFIED',
  generalDescription: `Pada akhir Fase ${record.phase}, murid memiliki kemampuan sebagai berikut:`,
  notes: `Rumusan elemen ditranskripsi dan diperiksa visual terhadap Keputusan Kepala BKPDM Nomor 020 Tahun 2026, Lampiran I, bagian 1.1.D, halaman PDF/cetak ${record.pages.join('–')}. Pergantian baris dan pemenggalan kata karena tata letak disatukan. GeneralDescription hanya pengantar; authority substansi berada pada elements. Audit sumber: docs/pai-cp-2026-integration.md.`,
  evidence: [{
    regulationId: 'DEC-BKPDM-020-2026',
    sourceUrl: 'https://kurikulum.kemendikdasmen.go.id/service/download.php?kategori=rujukan&id=142',
    locator: {
      attachment: 'Lampiran I',
      section: `1.1.D.${index + 1}. Capaian Pembelajaran PAI Fase ${record.phase}`,
      page: record.pages[0],
      note: `Halaman PDF dan cetak ${record.pages[0]}–${record.pages[1]}; SHA-256 598278746b0f62333fdcab520d5dd4c1a9650c94bd3906acff4254100976552b.`,
    },
  }],
  elements: record.contents.map((content, i) => ({
    number: `${index + 1}.${i + 1}`,
    name: elementNames[i],
    content,
  })),
}));
