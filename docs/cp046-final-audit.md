# Finalisasi PR #1: sumber CP tambahan dan kompatibilitas main

Baseline: `7dd4c39f107c184719c6069165a265709f66d6f9`. Branch tetap `feat/cp-smp-sma-046-2025`; tidak membuat PR baru atau merge.

## Hasil audit dan perbaikan

1. `cp/index.ts`: supersedesEntryIds dihapus bersama penggabungan registry impor ke registry default. Default tetap 62 sumber main; 84 sumber tambahan berada di `REVIEW_CP046_ENTRIES`, dengan opt-in `sourceSet: review046`. Pemisahan ini menghindari ambiguitas lintas kelompok tanpa mengubah prioritas historis. Konflik dalam satu kelompok tetap AMBIGUOUS dan tidak dapat dipilih.
2. `subjects.ts`: seluruh katalog, alias dan fuzzy matching main dipulihkan. Kode unik tambahan hanya digunakan dalam katalog khusus CP046. Daftar pilihan lama tetap utuh dan urutannya sama; nama tambahan ditambahkan di belakang.
3. `CPManager.tsx`: konfirmasi dan metadata penerapan sumber historis dipulihkan persis main. Sumber REVIEW ditawarkan dengan label khusus, tidak dipilih otomatis, dan hanya dimuat ke draft lokal. Tidak ada onSaveCP sampai pengguna melakukan penyimpanan eksplisit. Identitas cpId/cpVersion/regulationIds proyek tidak ditulis ulang saat memilih sumber.
4. Metadata regulasi historis dikembalikan persis main. Metadata PDF/provenance impor tetap disimpan terpisah pada sourceReview/evidence. Tidak ada perubahan JSON sumber maupun promosi VERIFIED.

App, storage, workflow dan implementasi COPY/ZIP identik dengan main; tidak ada migrasi otomatis. Kode/tes navigasi, kalender, ATP, PROTA, PROMES dan modul ajar tidak diubah.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| CP046 review integration | PASS: 84 record, 327 elemen, 30 subelemen, hash JSON asli, kode unik, fase/jenjang/tahun 2024/2025–2026/2027, label, REVIEW |
| CP046 safety | PASS: semua 84 sumber melewati ZIP RESTORE/COPY; teks, hierarki, ID sumber, metadata, profil dan sumber asal utuh |
| CP046 compatibility against actual main modules | PASS: 1.745 konteks resolver/pencarian historis identik; katalog/fuzzy matching dan pilihan lama identik; callback historis menghasilkan konfirmasi, metadata dan identitas CP yang sama |
| Draft-only selection and persistence | PASS: semua 84 pilihan eksplisit tidak memanggil onSaveCP atau menulis localStorage; CP/TP/ATP tersimpan identik setelah reload; cancel tidak mengubah draft |
| CP source search runtime / PJOK SD resolver | PASS / PASS |
| CP semantic review / Annual CP runtime | PASS / PASS |
| CP analysis integrity / CP analysis runtime | PASS / PASS |
| Complete project archive / Storage persistence / Storage contract | PASS / PASS / PASS |
| Production build | PASS; peringatan ukuran chunk tetap ada |
| TypeScript seluruh repository | FAIL: 68 diagnostik identik dengan baseline main pada SHA di atas; tidak ada diagnostik baru |
| Curriculum master | FAIL pada assertion CP historis SD PJOK 2024/2025 yang sama di main |

Tes kompatibilitas memuat kode main langsung dari Git, bukan snapshot ekspektasi buatan. Handler CPManager diekstrak dan dijalankan sebagai fungsi aktual; pengujian ini tidak mencakup klik browser atau validasi visual dokumen. Tidak memakai data guru nyata.

## CI dan batas yang tersisa

[Run main](https://github.com/lkpbudibakti-netizen/alco-adm-v-20-finishing/actions/runs/40671332430) dan [run PR sebelum finalisasi](https://github.com/lkpbudibakti-netizen/alco-adm-v-20-finishing/actions/runs/40818530949) sama-sama gagal pada `testMerdekaV5SemesterNavigation.ts:306`: ekspektasi ATP langsung ke semester. File tersebut dan navigasi produksi identik dengan main, sehingga diklasifikasikan masalah baseline dan tidak diperbaiki di PR CP.

Semua impor tetap UNVERIFIED/REVIEW. Validasi akhir redaksi terhadap PDF dan masa implementasi hukum agama 2026 belum diklaim selesai. Sumber agama 046/2025 tidak mengganti sumber agama 2026; agama SMA F 2026/2027 tanpa sumber 2026 tetap tidak tersedia.

Tidak ditemukan regresi baru pada pemeriksaan CP yang dijalankan. Pernyataan ini tidak berarti seluruh CI hijau atau validasi browser/PDF selesai. Merge tetap keputusan pengguna.

## File dalam commit finalisasi

- `docs/cp046-final-audit.md`
- `docs/cp046-review-integration.md`
- `package.json`
- `scripts/testCP046CompatibilityRegression.ts`
- `scripts/testCP046ReviewIntegration.ts`
- `scripts/testCP046SafetyRegression.ts`
- `scripts/testCPSourceSearchRuntimeRegression.ts`
- `src/components/CPManager.tsx`
- `src/data/curriculum/cp/index.ts`
- `src/data/curriculum/cp/sma.ts`
- `src/data/curriculum/cp/smp.ts`
- `src/data/curriculum/cp/types.ts`
- `src/data/curriculum/regulations.ts`
- `src/data/curriculum/subjects.ts`
- `src/data/curriculumDefaults.ts`
- `src/services/cpSourceRepository.ts`
