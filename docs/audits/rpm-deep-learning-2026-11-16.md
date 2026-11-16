# RPM dan Pembelajaran Mendalam — audit P0 → P1 → P2

Repository `lkpbudibakti-netizen/v22`, branch `main`. Baseline pekerjaan RPM: `87dd2dd73f1fec4125c2a5fb9ce1bdc27d8743ca` (perbaikan identitas/kalender/jadwal sebelumnya sudah dipisahkan). Selama pengerjaan muncul commit lokal `56983e6df6f55d400138849dc83160c9a8b6f2c7` yang memuat P0/P1 dan tes, kemudian `a6ed5997e31bfcdc4f37404a6c69d8ab724391e2` yang memuat P2/registrasi. Kedua commit dipertahankan tanpa amend/reset; commit penutup menambahkan laporan verifikasi ini saja.

## Acuan resmi yang diverifikasi

- [Permendikdasmen 13/2025, JDIH](https://jdih.kemendikdasmen.go.id/sjdih/siperpu/dokumen/salinan/Permendikdasmen_No_13_Tahun_2025_ttg_Perubahan_atas_Permendikbudristek_No_12_Tahun_2024_ttg_Kurikulum_pada_Pendidikan_Anak_Usia_Dini_Jenjang_Dikdasmen.pdf): perubahan kerangka dasar mencantumkan pendekatan Pembelajaran Mendalam; lampiran menjelaskan prinsip dan pengalaman memahami, mengaplikasi, merefleksi. Patch tidak mengganti kurikulum/CP/TP/ATP.
- [Kepmendikdasmen 126/P/2025, salinan resmi BPMP](https://bpmpbabel.kemendikdasmen.go.id/PPID/wp-content/uploads/2025/09/Salinan-Kepmendikdasmen-Nomor-126_P_2025-CAP.pdf): pedoman implementasi dan dukungan desain praktik pedagogis, lingkungan, kemitraan, serta digital. Keempat aspek direpresentasikan menggunakan framework yang sudah ada; tidak memaksa pihak luar/teknologi ketika tidak diperlukan.
- [Permendikdasmen 1/2026, JDIH](https://jdih.kemendikdasmen.go.id/sjdih/siperpu/dokumen/salinan/Salinan%20Permendikdasmen%201%202026%20Standar%20Proses%20%28JDIH%29.pdf), Pasal 4–5: dokumen perencanaan paling sedikit memuat tujuan, langkah, dan penilaian/asesmen. Implementasi menawarkan penyajian RPM, tidak menyatakan satu contoh template sebagai format wajib tunggal.
- [Panduan Mata Pelajaran PJOK 2025, Puskurjar/BSKAP](https://kurikulum.kemendikdasmen.go.id/file/panduan/dokumen/Panduan%20Mata%20Pelajaran%20PJOK.pdf), bagian Perencanaan Pembelajaran Mendalam dan contoh penerapannya: pengalaman belajar, prinsip kontekstual, dan rancangan sesuai lingkup kompetensi. Uji lintas jenjang adalah fixture representatif renderer/durasi SD–SMP–SMA, bukan sertifikasi kualitas pedagogis konten nyata seluruh mapel.

## Temuan kode dan P0

Jalur aktif DOCX dan PDF sudah memanggil `buildModulAjarProjection`. Pada case PDF Modul Ajar, loop sections bersama diakhiri `break`; blok lama di bawahnya tidak aktif. Karena itu tidak dilakukan penggantian engine atau penghapusan besar kode legacy.

Gap yang terbukti: konteks framework/prinsip belum ditampilkan; sebagian metode asesmen tidak muncul di DOCX; DOCX memaksakan empat nama level KKTP, sedangkan proyeksi PDF memuat level/label aktual, catatan, pendekatan dan ambang. Pengalaman unit tanpa meeting dapat luput dari keluaran, dan uraian sama dalam core/experience bisa tercetak berulang.

Perubahan P0:

- Formatter bersama untuk asesmen dan konteks; rincian yang tersedia tercetak di kedua format.
- Tabel Modul Ajar dipertahankan. Baris aktivitas memakai `activityLines` proyeksi yang sama, bukan interpretasi renderer terpisah.
- Narasi core/experience yang identik persis pada lingkup yang sama ditampilkan sekali dengan label fase tetap dipertahankan. Tidak menghapus/mengubah data atau memakai kemiripan kata untuk menyimpulkan kesetaraan.
- Pengalaman unit/global dicetak tanpa mengarang meeting. ATP diringkas dari langkah/fokus kanonis; ID dan hubungan aslinya tetap di proyeksi.
- Level KKTP aktual, pendekatan, ambang dan catatan dipertahankan; tidak menulis KKTP baru.
- Helper TTD/pagination existing tetap dipakai. Versi renderer dinaikkan agar hasil lama tidak disamakan dengan renderer baru.

P0 dievaluasi dengan file DOCX/PDF nyata untuk tiga fixture jenjang sebelum melanjutkan P1: PASS.

## P1 — data, prompt, dan validasi

`DeepLearningFrameworkContext` sudah mempunyai empat aspek desain, tetapi `normalizeDeepLearningContext` membuang `framework`. Normalizer kini mempertahankannya, termasuk daftar kosong eksplisit untuk kemitraan/digital yang tidak direncanakan. `targetStudents` dan `initialCompetency` tetap dipakai untuk kesiapan/prasyarat; hanya `materialCharacteristics` ditambahkan sebagai field opsional karena belum ada representasi setara.

Schema/prompt generasi dan repair memakai field yang sama. Prompt membedakan asumsi kesiapan dari hasil asesmen nyata, menjaga cakupan/ID/urutan/JP/durasi, meminta uraian operasional dan hubungan TP yang tepat, menghindari pengulangan core/experience, dan tidak mengharuskan ketiga prinsip pada tiap aktivitas. Tidak ada provider, generator RPM AI atau retry baru; mekanisme repair maksimum satu kali existing dipertahankan.

Respons AI baru diperiksa menggunakan perluasan validator existing yang dipakai backend dan frontend: tiga fase, empat aspek desain, pilihan prinsip sah, relasi TP dalam scope/pertemuan, tiga kelompok asesmen dan cakupan TP asesmen akhir. Normalisasi asesmen mempertahankan linkedTpIds eksplisit, bukan selalu menggantinya dengan seluruh TP unit. Fallback lama untuk payload tanpa daftar eksplisit dipertahankan pada jalur kompatibilitas; endpoint baru meminta daftar eksplisit sebelum normalisasi.

Pemeriksaan ini membuktikan struktur, referensi, dan anggaran, bukan sertifikat kesesuaian semantik independen. AI menghasilkan DRAFT, bukan otomatis SIAP; guru tetap meninjau kualitas/substansi. Tidak digunakan skor kesamaan kata/jumlah kata sebagai penentu kelulusan pedagogis. UI menyediakan detail desain tertutup secara default dan karakteristik materi opsional. Data lama tidak otomatis gagal, diisi atau diminta regenerasi karena field baru belum ada.

P1 dievaluasi sebelum P2: respons lengkap lolos, delapan variasi invalid ditolak, anggaran/ID terjaga, framework bertahan, dan ekspor historis tetap tersedia: PASS. Pengujian provider menggunakan mock.

## P2 — satu LearningPlan, dua penyajian

`learningPlanPresentation` adalah opsi context ekspor sementara (`MODUL_AJAR` default / `RPM`), bukan document type, storage atau AI generator baru. Pilihan tersedia pada AdminDocsExport, termasuk preview, ekspor individual/bulk dan ZIP.

RPM mengelompokkan sections proyeksi yang sama menjadi Identifikasi, Desain Pembelajaran, Pengalaman Belajar, dan Asesmen. Kegiatan pertemuan, TP/ATP/materi, tanggal, JP, durasi, diferensiasi dan refleksi tetap sama. Field lama yang belum tercatat diberi keterangan jujur, bukan diisi dengan data murid/fasilitas rekaan. Format Modul Ajar tetap default dengan tabelnya. Identitas, documentDate dan TTD tetap mengikuti context/snapshot policy existing; nama file RPM dibedakan tanpa menggandakan LearningPlan.

`modulAjarExportContext`, dispatcher `documentEngine/index`, snapshot dan kalender/jadwal cukup diaudit; kontraknya sudah meneruskan context/proyeksi dengan benar, sehingga tidak diimplementasikan ulang pada pekerjaan RPM ini. Penguncian historical exact LearningPlan revision tetap berlaku.

## File berubah dibanding baseline RPM

- `server.ts`: schema, prompt, prompt repair dan pemanggilan validator scope TP untuk respons baru.
- `src/types/index.ts`: field opsional karakteristik materi.
- `src/services/learningPlanService.ts`: normalisasi framework/referensi, validator desain AI baru, pelestarian field pada factory/legacy conversion.
- `src/services/aiService.ts`: pemeriksaan desain respons melalui validator bersama.
- `src/components/administration/LearningPlanManager.tsx`: detail desain dan tinjauan opsional.
- `src/services/documentEngine/modulAjarProjection.ts`: substansi/formatter bersama, deduplikasi exact untuk tampilan, adapter penyajian RPM.
- `src/services/documentEngine/generators/modulAjarGenerator.ts`, `renderers/pdf/pdfDocGenerators.ts`: konsumsi proyeksi dan pilihan penyajian.
- `src/services/documentEngine/types.ts`, `src/components/AdminDocsExport.tsx`: opsi penyajian, kontrol dan preview.
- `src/services/documentEngine/annualZipPlan.ts`, `zipBundle.ts`: nama file RPM pada paket tanpa perubahan skema.
- `src/config/modulAjarRendererVersion.ts`: versi renderer.
- `scripts/testDeepLearningRPM.ts`, `scripts/ci/test-groups.json`, `package.json`: regresi dan registrasi tes.
- Laporan ini.

## Hasil pengujian

| Skenario | Hasil |
|---|---|
| Substansi DOCX/PDF SD, SMP, SMA | PASS — marker data nyata fixture pada kedua berkas |
| Struktur AI lengkap dan delapan respons invalid | PASS — frontend/backend, mock provider |
| ID TP/pertemuan, cakupan asesmen akhir, durasi salah | PASS — referensi/durasi invalid ditolak |
| Historical LearningPlan tanpa field baru | PASS — projection dan ekspor DOCX/PDF |
| Anggaran setiap meeting sesuai 35/40/45 menit per JP | PASS |
| Framework opsional tanpa digital/kemitraan eksternal | PASS — [] dipertahankan, tidak diisi paksa |
| RPM/Modul Ajar satu plan; switch UI tidak memanggil AI | PASS — handler aktual dan kesetaraan proyeksi |
| Duplikasi exact core/experience | PASS — satu narasi, label Memahami tetap; isi plan tidak dihapus |
| Margin PDF dan TTD nama/NIP panjang | PASS — koordinat teks dan identitas TTD pada halaman akhir yang sama |
| Proteksi TTD DOCX | PASS struktural — keepNext/cantSplit pada XML; bukan render Word |
| Impor guru/sekolah lain dan ZIP Produksi RPM | PASS — dua file nyata DOCX/PDF, identitas tujuan, sumber tidak berubah |
| Normal dan regresi existing | PASS — CI penuh 63/63 suite |

`npm.cmd run test:rpm`, lint/TypeScript (`tsc --noEmit`), build frontend/PWA/server dan `git diff --check` PASS. CI lengkap: storage 24, planning 22, documents 12, transport 5; seluruhnya exit 0. Hasil/log lokal pada `artifacts/ci/` dan `tmp/import-tp-audit/`, tidak dilacak Git. Warning ukuran bundle existing tetap muncul.

## Batas bukti dan risiko

Gemini live tidak diuji. Kualitas pedagogis/faktual dari provider belum dapat disertifikasi oleh tes mock/struktur; draf tetap perlu review guru, khususnya asumsi kesiapan. Native Word/LibreOffice visual rendering dan browser interaktif belum diuji. Bukti DOCX adalah isi/guard XML dan bukti PDF adalah isi, koordinat margin dan posisi identitas TTD, bukan jaminan visual seluruh renderer/printer. Tidak ada klaim seluruh isi mapel/jenjang telah diuji pedagogis secara nyata. Tidak ada migrasi, penghapusan histori, perubahan CP/TP/ATP/KKTP atau implementasi ulang perubahan jadwal pada commit RPM.
