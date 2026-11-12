# Integrasi CP PAI 020/2026

Audit 12 November 2026, baseline `51afde035b4a262426b350ec3d72e40d0736a285`.

## Sumber dan pemeriksaan

Authority teks adalah **Keputusan Kepala BKPDM Nomor 020 Tahun 2026**, Lampiran I, bagian **1.1 Pendidikan Agama Islam dan Budi Pekerti**, D. Capaian Pembelajaran.

- [PDF keputusan resmi](https://kurikulum.kemendikdasmen.go.id/service/download.php?kategori=rujukan&id=142): 79 halaman, 8.510.107 byte; SHA-256 `598278746b0f62333fdcab520d5dd4c1a9650c94bd3906acff4254100976552b`.
- [Panduan resmi PAI 2026](https://kurikulum.kemendikdasmen.go.id/file/panduan/dokumen/Panduan%20Mata%20Pelajaran%20Pendidikan%20Agama%20Islam%20dan%20Budi%20Pekerti.pdf): 200 halaman, 4.855.803 byte; SHA-256 `ef79015c9d797b769e1fba2a7a7f4dbcc6e1d0c972c038a43f3d9c33b012cfbd`.

PDF keputusan berupa hasil pindai. Halaman 4 dan 6–9 dirender untuk pemeriksaan visual; 30 rumusan elemen ditranskripsi dari halaman 6–9 dan dibandingkan dengan bagian CP pada panduan, halaman PDF 17–20. OCR bukan bukti verifikasi. Tidak ada rumusan TP, ATP, contoh kegiatan, atau uraian materi esensial panduan yang dimasukkan ke konten CP.

| Fase | Jenjang | PDF keputusan / halaman cetak | PDF panduan / halaman cetak |
| --- | --- | --- | --- |
| A | SD | 6–7 / 6–7 | 17 / 11 |
| B | SD | 7 / 7 | 17–18 / 11–12 |
| C | SD | 7–8 / 7–8 | 18 / 12 |
| D | SMP | 8 / 8 | 18–19 / 12–13 |
| E | SMA | 8 / 8 | 19 / 13 |
| F | SMA | 9 / 9 | 19–20 / 13–14 |

Judul Fase F dimulai di halaman 8; seluruh rumusan elemennya ada di halaman 9. Fikih Fase C terpotong secara tata letak antara halaman 7 dan 8, dan disatukan tanpa menghilangkan kata.

Perbedaan editorial panduan dicatat, bukan diadopsi: B 2.5 menggunakan `SAW.` dan `Makkah..`, sedangkan keputusan `saw.` dan `Makkah.`; C 3.2 berbeda karakter hamzah; C 3.3 `non muslim` di panduan tetapi `non-muslim` di keputusan; C 3.5 `SAW.` versus `saw.`; E 5.5 `islam` versus `Islam`. Tidak ditemukan perbedaan cakupan kompetensi. Teks aplikasi mengikuti keputusan. Nama elemen pertama mengikuti sumber **Al-Qur’an Hadis**, bukan label generik paket **Al-Qur'an dan Hadis**.

Pergantian baris dan pemenggalan kata di ujung baris disatukan; gaya italik tidak dipertahankan dalam string. Ejaan, kapitalisasi, tanda baca, dan transliterasi mengikuti sumber primer. `generalDescription` hanya pengantar, bukan CP pengganti. Manifest `src/data/curriculum/cp/sources/pai-bkpdm-020-2026-manifest.json` mencatat sumber, hash PDF, halaman tiap elemen, serta hash SHA-256 UTF-8 tiap konten untuk mendeteksi perubahan setelah audit. Hash konten mengunci hasil transkripsi; bukan alat yang secara mandiri membuktikan kesamaan dengan gambar PDF.

## Perubahan dan kompatibilitas

Sebelumnya hanya A/D/E tersedia untuk PAI 2026, masih UNVERIFIED dan berisi ringkasan yang berbeda dari keputusan. Kini enam fase × lima elemen tersedia dari `pai2026.ts`, terhubung melalui registry SD/SMP/SMA existing. ID A/D/E dipertahankan; B/C/F ditambahkan sesuai manifest paket. Semua menggunakan `DEC-BKPDM-020-2026`, mulai TA 2026/2027, tanpa tanggal berakhir buatan.

Resolver, subject selection, repository sumber, validator, dan CPManager Step 3 diaudit. Status resolusi dan verifikasi sudah dipisahkan; tidak diperlukan perubahan engine/UI. Bukti memakai interface evidence existing, tanpa memasukkan PAI 2026 ke sourceReview yang khusus integrasi 046/2025.

Tidak ada migrasi atau penulisan otomatis ke proyek guru. CP historis 2025/2026, CP manual, TP/ATP, dan semua mapel lain dipertahankan. Guru tetap harus memilih sumber dan menyetujui penggantian CP yang terisi melalui mekanisme Step 3 existing. Pembaruan registry tidak mengganti label/status sumber pada snapshot CP lama secara diam-diam.

Golden regression 046/2025 sebelumnya mengunci seluruh registry termasuk placeholder PAI 2026. Ekspektasinya dipersempit hanya pada ruang perubahan PAI 020/2026; snapshot byte-identik di luar ruang tersebut direkam **sebelum perubahan** dalam `pai-cp-2026-baseline.json`. Konten baru diuji terpisah, bukan dengan memperbarui seluruh baseline secara buta.

## Verifikasi yang dapat diulang

`npm run test:pai-2026` memeriksa enam fase/30 elemen, fingerprint konten, evidence, tahun/alias, ambiguity, handler pemilihan Step 3, konfirmasi penggantian CP manual, V5 save/reload, dan tidak adanya mutasi saat browsing sumber. Ini pengujian lokal deterministik; bukan browser interaktif, Gemini live, atau deployment.

Pemeriksaan PDF dilakukan visual pada sumber resmi yang diunduh; PDF biner dan gambar sementara tidak dilacak Git. Untuk mengulang audit sumber, unduh URL di atas, cocokkan SHA-256 (PowerShell `Get-FileHash -Algorithm SHA256`), lalu periksa halaman sesuai manifest. Jika hash sumber berubah, jangan mengasumsikan sumber baru identik.

## Temuan regresi di luar integrasi

Hasil akhir pemeriksaan lokal:

| Pemeriksaan | Hasil |
| --- | --- |
| Transkripsi sumber primer, enam fase / 30 elemen | PASS, pemeriksaan visual halaman 6–9 |
| `npm run test:pai-2026` | PASS, termasuk 36 pencarian tahun/alias, handler Step 3, V5 |
| CI storage | PASS 23/23 |
| CI planning | PASS 19/19 |
| CI documents | PASS 8/8 |
| CI transport | PASS 5/5, termasuk server development smoke |
| `npm run lint` (TypeScript `tsc --noEmit`) | PASS, diulang terhadap perubahan terakhir |
| `npm run build` | PASS frontend dan server; peringatan ukuran chunk existing |
| CP046 compatibility, safety, review; CP search runtime; Step08 JP integration | PASS |
| `testCurriculumMaster.ts` | FAIL pada kasus historis existing, dijelaskan di bawah |
| `testAudit2026RegulatoryCompatibility.ts` | FAIL enam assert existing, dijelaskan di bawah |

Total akhir kelompok CI adalah 55/55 suite PASS. Pemanggilan CI `all` pertama keluar dengan kode 1 karena testCPGapFollowup masih mengharapkan PAI 2026 UNVERIFIED/tidak tersedia pada B/C. Setelah ekspektasi PAI tersebut diperbarui sesuai sumber yang diaudit, seluruh kelompok storage diulang dan 23/23 PASS. Planning, documents, dan transport dari putaran yang sama seluruhnya PASS. Ini bukan klaim bahwa dua suite tambahan di bawah juga lulus.

Pengujian tambahan tidak seluruhnya hijau. Keduanya diulang pada checkout terpisah commit baseline `51afde0` dengan hasil identik:

- `testCurriculumMaster.ts`: gagal pada ekspektasi CP PJOK historis TA 2024/2025 harus RESOLVED. Resolver existing menyaring entri SUPERSEDED; entri historis tersebut berstatus SUPERSEDED. Registry PJOK dan resolver tidak berubah dalam integrasi ini. Ekspektasi awal lain yang hanya mengizinkan VERIFIED untuk 046/2025 sudah diperbarui khusus PAI 020/2026 agar tes mencapai kegagalan historis yang sama dengan baseline.
- `testAudit2026RegulatoryCompatibility.ts`: 84 pemeriksaan PASS, enam pemeriksaan teks/judul bagian dokumen modul ajar FAIL, sama persis pada baseline. Generator dan pengujian ini tidak diubah.

Jangan mengartikan keberhasilan tes integrasi PAI, lint, atau build sebagai keberhasilan kedua suite tersebut. Tampilan browser interaktif, deployment, dan Gemini live tidak diuji dalam pekerjaan integrasi data ini.
