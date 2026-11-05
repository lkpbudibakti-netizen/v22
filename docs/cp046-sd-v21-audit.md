# Audit dan integrasi CP SD V21 - 1 November 2026

Checkout: `pkbmcwd92-cpu/Alco-Adm-v21-Penyesuaian-JP-dan-Jadwal`, branch `main`, baseline `a5bbe8aaae553eef4de4dd7824c9ac27cc17b62b`. Perubahan lokal; tidak melakukan merge V20, commit, atau push.

## Hasil dan sumber

47 kombinasi SD pada matriks paket: **36 ditambahkan dengan pencocokan sumber**, **9 sudah berlabel 046 di registry dan dipertahankan**, **2 UNVERIFIED dikarantina**. Dari 38 kandidat, 28 sebelumnya tanpa entri SD dan 10 hanya memiliki versi 032/2024. Sembilan dari sepuluh kandidat versi lama kini mempunyai pilihan 046 tambahan; Matematika A tetap historis/manual. Semua data historis dipertahankan identik, bukan ditimpa.

Sumber lokal: `E:/Downloads/Kumpulan%20CP.pdf`, SHA-256 `f8e5f478de4dc1790bfc800104135f992c8fe6cb2d8f770f46b616932a2aec34`. Paket: `E:/Downloads/CP_V21_Paket_Audit_Integrasi.zip`. README, CSV, dan kedua JSON dibaca sebagai bahan audit, bukan instruksi pengganti permintaan pengguna.

Setiap bagian bernomor dari seluruh 38 kandidat dicocokkan secara independen memakai pdfplumber terhadap halaman PDF fisik (1-based). Hanya whitespace tata letak dinormalisasi; ejaan, tanda baca, istilah dan terjemahan sumber tidak dikoreksi. Render seluruh halaman kandidat diperiksa untuk batas fase, struktur elemen/subelemen dan konten nonteks. Pemeriksaan struktur visual bukan klaim pemeriksaan tampilan aplikasi.

Entri 36 yang diintegrasikan menyimpan identitas kanonikal existing (`MAT`, bukan membuat `MTK` baru), nomor dan ID elemen/subelemen, teks ekstraksi mentah, label terpisah dari konten, hash PDF, Lampiran II, bagian, rentang halaman, regulasi dan tahun implementasi. Hierarki PAK B/C mempertahankan masing-masing 10 subelemen. Butir bertanda bullet dalam Keterampilan Proses IPAS tetap utuh di dalam konten elemennya; bukan dibuat menjadi elemen CP bernomor baru. Pemetaan bagian `VI` ke `IPAS` dan lookup IPAS ditambahkan ke adapter/katalog 046 existing.

`VERIFIED_SOURCE_MATCH` pada sumber SD berarti teks, struktur, identitas fase dan halaman telah dicocokkan pada audit ini, lalu diadaptasi menjadi `VERIFIED`. Tidak ada promosi 84 entri SMP/SMA: semuanya tetap `UNVERIFIED`, identik dengan baseline. Sembilan entri 046 existing tidak dipromosikan atau disertifikasi ulang oleh audit 38 kandidat ini.

## Kandidat ditahan

- `MAT/A`, PDF 111-112: contoh bergambar Aljabar pada PDF 112 hilang dari ekstraksi teks. Tidak mengarang deskripsi/persamaan pengganti. Sumber baru ini tidak masuk runtime; versi historis dan CP manual tetap tersedia.
- `BING/C`, PDF 134-135: sumber menulis Fase C tetapi kelas III/IV, serta `Listening - Writing` pada nama elemen Menyimak-Berbicara. Kesalahan/kekaburan ada pada PDF, bukan diperbaiki diam-diam. Tetap UNVERIFIED dan tidak masuk runtime; kelas V/VI tidak diklaim tervalidasi untuk entri ini.
- CP `CODING_AI/B` existing berlabel 046 tidak ditemukan dalam blok Fase B Lampiran II. Tidak dihapus atau diubah pada integrasi ini; tidak dihitung sebagai salah satu dari 47 kombinasi sumber. Fase C kini memiliki sumber halaman 342-343 (teks CP berada pada 343).

## Kontrak resolver dan Step 03

36 entri masuk pool pilihan eksplisit `sourceSet: 'review046'` yang sudah ada, sehingga tidak bercampur dengan pool historis dan tidak menciptakan AMBIGUOUS palsu akibat dua versi. Nama teknis pool dipertahankan demi kompatibilitas; entri SD yang cocok sumber berstatus VERIFIED, SMP/SMA tetap UNVERIFIED. Pencarian Step 03 `searchSourceChoices` sudah menampilkan kedua pool. Memuat sumber tetap melalui draft dan Simpan CP eksplisit; tidak ada migrasi atau penggantian CP guru otomatis.

Status resolusi tetap `RESOLVED | UNRESOLVED | AMBIGUOUS`; verifikasi (`VERIFIED | UNVERIFIED`) adalah atribut sumber, bukan status resolver baru. UI membedakan keduanya. Dropdown SD menampilkan katalog mapel yang sah meskipun CP belum tersedia, ditahan, kedaluwarsa, atau ambigu, dan menunjukkan jalur manual. Sumber ambigu tetap tidak dapat dipilih sebagai CP resmi. Dropdown SMP/SMA dan kontrak resolver tidak diubah.

Implementasi sumber baru mulai 2025/2026, mengikuti metadata registry existing. Agama berakhir 2025/2026 menurut batas 020/2026 yang sudah dicatat repository; pada 2026/2027 sumber agama 046 tambahan ini UNRESOLVED. Tidak mengarang CP agama 020/2026. Tahun 2024/2025 dan seluruh perilaku pool historis, termasuk pembatasan SUPERSEDED existing, tetap identik baseline.

Matriks CSV juga memisahkan kondisi registry dari visibilitas dropdown sebelum/sesudah pada 2025/2026. Visibilitas awal diambil dari eksekusi `getSubjectChoices` pada worktree baseline V21, bukan disimpulkan dari label CSV paket. Ketiadaan CP bukan alasan menghapus mapel sah dari katalog.

## Matriks sebelum/sesudah (47 kombinasi)

Kolom halaman mengacu PDF fisik lokal dengan hash di atas. Matriks CSV pendamping memuat hasil untuk tiga tahun ajaran. `existing unchanged` berarti entri lama dipertahankan, bukan klaim audit/verifikasi baru atau jaminan status runtime tahun tertentu.

| Mapel | Fase | Sebelum | Sesudah | Halaman PDF |
|---|---|---|---|---|
| PAI | A | 046 existing | 046 existing unchanged | 26-27 |
| PAI | B | No SD record | 046 VERIFIED (explicit source choice) | 27-28 |
| PAI | C | No SD record | 046 VERIFIED (explicit source choice) | 28-28 |
| PAK | A | 046 existing | 046 existing unchanged | 34-35 |
| PAK | B | No SD record | 046 VERIFIED (explicit source choice) | 35-37 |
| PAK | C | No SD record | 046 VERIFIED (explicit source choice) | 37-38 |
| PKAT | A | 046 existing | 046 existing unchanged | 46-47 |
| PKAT | B | No SD record | 046 VERIFIED (explicit source choice) | 47-48 |
| PKAT | C | No SD record | 046 VERIFIED (explicit source choice) | 48-49 |
| PHINDU | A | 046 existing | 046 existing unchanged | 56-56 |
| PHINDU | B | No SD record | 046 VERIFIED (explicit source choice) | 56-57 |
| PHINDU | C | No SD record | 046 VERIFIED (explicit source choice) | 57-57 |
| PBUDDHA | A | 046 existing | 046 existing unchanged | 62-63 |
| PBUDDHA | B | No SD record | 046 VERIFIED (explicit source choice) | 63-64 |
| PBUDDHA | C | No SD record | 046 VERIFIED (explicit source choice) | 64-65 |
| PKHONGHUCU | A | 046 existing | 046 existing unchanged | 71-72 |
| PKHONGHUCU | B | No SD record | 046 VERIFIED (explicit source choice) | 72-73 |
| PKHONGHUCU | C | No SD record | 046 VERIFIED (explicit source choice) | 73-74 |
| PANCASILA | A | 032/2024 only | 046 VERIFIED (explicit source choice) | 82-83 |
| PANCASILA | B | 032/2024 only | 046 VERIFIED (explicit source choice) | 83-84 |
| PANCASILA | C | No SD record | 046 VERIFIED (explicit source choice) | 84-85 |
| BINDO | A | 032/2024 only | 046 VERIFIED (explicit source choice) | 94-95 |
| BINDO | B | 032/2024 only | 046 VERIFIED (explicit source choice) | 95-95 |
| BINDO | C | 032/2024 only | 046 VERIFIED (explicit source choice) | 95-96 |
| MAT | A | 032/2024 only | UNVERIFIED / quarantined; historical retained | 111-112 |
| MAT | B | 032/2024 only | 046 VERIFIED (explicit source choice) | 112-114 |
| MAT | C | 032/2024 only | 046 VERIFIED (explicit source choice) | 114-116 |
| BING | B | No SD record | 046 VERIFIED (explicit source choice) | 133-134 |
| BING | C | No SD record | UNVERIFIED / quarantined; historical retained | 134-135 |
| IPAS | B | 032/2024 only | 046 VERIFIED (explicit source choice) | 149-151 |
| IPAS | C | 032/2024 only | 046 VERIFIED (explicit source choice) | 151-153 |
| SENI_MUSIK | A | No SD record | 046 VERIFIED (explicit source choice) | 238-239 |
| SENI_MUSIK | B | No SD record | 046 VERIFIED (explicit source choice) | 239-240 |
| SENI_MUSIK | C | No SD record | 046 VERIFIED (explicit source choice) | 240-241 |
| SENI_RUPA | A | No SD record | 046 VERIFIED (explicit source choice) | 246-247 |
| SENI_RUPA | B | No SD record | 046 VERIFIED (explicit source choice) | 247-247 |
| SENI_RUPA | C | No SD record | 046 VERIFIED (explicit source choice) | 247-248 |
| SENI_TARI | A | No SD record | 046 VERIFIED (explicit source choice) | 256-257 |
| SENI_TARI | B | No SD record | 046 VERIFIED (explicit source choice) | 257-257 |
| SENI_TARI | C | No SD record | 046 VERIFIED (explicit source choice) | 257-258 |
| SENI_TEATER | A | No SD record | 046 VERIFIED (explicit source choice) | 264-264 |
| SENI_TEATER | B | No SD record | 046 VERIFIED (explicit source choice) | 264-265 |
| SENI_TEATER | C | No SD record | 046 VERIFIED (explicit source choice) | 265-266 |
| PJOK | A | 046 existing | 046 existing unchanged | 310-311 |
| PJOK | B | 046 existing | 046 existing unchanged | 311-312 |
| PJOK | C | 046 existing | 046 existing unchanged | 312-313 |
| CODING_AI | C | No SD record | 046 VERIFIED (explicit source choice) | 342-343 |

## Hasil regression test dan build

Semua pengujian memakai checkout V21 lokal dan storage tiruan di memori, tidak membaca/menimpa storage pengguna. Perintah TypeScript dijalankan melalui `node_modules/.bin/tsx.cmd`.

| Pemeriksaan | Hasil |
|---|---|
| `scripts/auditCP046SDSource.py` dengan PDF lokal | PASS: hash PDF cocok; seluruh 38 kandidat cocok per bagian bernomor; 36 entri runtime juga lolos pemeriksaan konservasi teks hasil pemisahan label/konten/subelemen. Pemeriksaan ini tidak mempromosikan status otomatis. |
| `scripts/testCP046SDIntegration.ts` | PASS: 38 kandidat individual, 36 runtime/2 karantina; seluruh katalog SD × A–C × 2024/2025, 2025/2026, 2026/2027; identitas, halaman, status, pembatasan agama dan tidak ada AMBIGUOUS. |
| Step 03 → Step 04 → Step 05 untuk sumber baru | PASS dalam test integrasi: input CP kanonikal diterima validator Step 04, fixture analisis terkait CP diterima, fixture TP terkait tepat pada butir analisis diterima validator existing Step 05. Ini uji kontrak/data dengan fixture, bukan uji klik browser atau kualitas hasil AI. |
| CP guru/Storage V5 dalam test integrasi | PASS: 36 CP beserta metadata/hierarki bertahan melalui `saveStorageV5` → `loadStorageV5`; perubahan teks guru tetap identik setelah pencarian sumber dan reload. |
| Snapshot registry/resolver baseline | PASS: hash seluruh historical, hash 84 SMP/SMA review, serta semua hasil resolver original pada tiga tahun ajaran identik. |
| `scripts/testSubjectSelectionRegression.tsx` | PASS: render/handler komponen, katalog SD tanpa CP, status ambigu/manual, alias dan nilai lama dipertahankan; SMP/SMA konsisten. |
| `scripts/testCP046ReviewIntegration.ts` | PASS: 84 SMP/SMA, 327 elemen, 30 subelemen, hash sumber, resolver, workflow, persistensi dan ZIP RESTORE. |
| `scripts/testCP046SafetyRegression.ts` | PASS: isolasi data sumber dan hasil pencarian; seluruh 84 sumber SMP/SMA ZIP RESTORE/COPY dan data guru tetap aman. |
| `scripts/testCPSourceSearchRuntimeRegression.ts` | PASS: pencarian PJOK SD A–C, mismatch, tahun tidak valid, ambigu, render diagnostik, pilihan stale dan tanpa fallback. |
| `scripts/testPJOKSDCPResolverRegression.ts` | PASS: teks PJOK existing A–C dan resolver tetap konsisten. |
| `scripts/testStep4DownstreamCompatibility.ts` | PASS: fixture existing Step 03–10, dua semester, data/gates/proyeksi/storage/reload/ZIP. Tidak memakai baseline output pembanding lintas commit pada perintah ini. Output fixture tetap melaporkan DOCX PEMETAAN_ATP_UNIT blocked dan peringatan lebar tabel; bukan bukti semua ekspor/visual sempurna. |
| `scripts/testStorageV5Persistence.ts` | PASS 7/7. |
| `scripts/testStorageV5Contract.ts` | PASS 8/8. |
| `npm.cmd run build` setelah perubahan sumber final | PASS, exit 0: Vite, PWA dan server bundle. Ada peringatan ukuran chunk >500 kB. |
| `tsc --noEmit --pretty false` | Exit 2: 67 diagnostik. Dibandingkan dengan eksekusi yang sama pada worktree HEAD awal: 67 diagnostik dan isi output identik, tidak ada tambahan. Bukan typecheck bersih. |

Tiga pengujian lama berikut gagal **baik pada checkout awal maupun sesudah integrasi**, direproduksi pada worktree terpisah dari commit baseline yang sama:

- `testMerdekaV5AnnualCPRuntime.ts`: 9 pemeriksaan data awal PASS, lalu assertion statis mengharapkan definisi `handleSaveCPAnalysis` di App yang tidak sesuai struktur existing.
- `testMerdekaV5CPAnalysisRuntime.ts`: 11 pemeriksaan persistensi/data awal PASS, lalu assertion statis yang sama gagal.
- `testCP046CompatibilityRegression.ts`: loader baseline menambahkan `.ts` pada JSON, sehingga mencoba `git show ...json.ts` dan gagal sebelum perbandingan.

Ketiganya tidak diperbaiki lewat perubahan workflow atau engine di luar lingkup. Pengujian integrasi baru memakai snapshot baseline data/resolusi dan fungsi Storage V5 nyata sebagai pemeriksaan langsung tambahan. Tidak menyatakan seluruh suite lulus.

## File berubah

1. `src/data/curriculum/cp/sources/cp-sd-bskap-046-2025-source-matched.json` — 36 sumber SD beserta bukti dan hierarki.
2. `src/data/curriculum/cp/sd046.ts` — adapter sumber SD dalam pool pilihan eksplisit.
3. `src/data/curriculum/cp/index.ts` — registrasi pool SD tambahan.
4. `src/data/curriculum/cp/review046Adapter.ts` — dukungan fase SD, bagian VI/IPAS dan status pencocokan khusus SD; keluaran SMP/SMA tetap identik.
5. `src/data/curriculum/subjects.ts` — identitas IPAS tersedia untuk lookup sumber 046.
6. `src/services/subjectSelection.ts` — katalog SD tetap tersedia terpisah dari status CP.
7. `src/components/SubjectSelect.tsx` — label UNRESOLVED/AMBIGUOUS dan jalur manual.
8. `src/components/CPManager.tsx` — label verifikasi sumber Step 03 eksplisit.
9. `scripts/testCP046SDIntegration.ts` — regresi kandidat, resolver, Step 03–05 dan storage.
10. `scripts/testSubjectSelectionRegression.tsx` — kontrak katalog SD/manual yang diperbarui.
11. `scripts/auditCP046SDSource.py` — pemeriksaan sumber independen yang dapat diulang.
12. `docs/cp046-sd-v21-baseline.json` — hash data dan resolusi checkout awal.
13. `docs/cp046-sd-v21-quarantine.json` — dua kandidat mentah, alasan dan sumber; tidak diimpor runtime.
14. `docs/cp046-sd-v21-matrix.csv` — 47 baris matriks registry/dropdown/tahun.
15. `docs/cp046-sd-v21-audit.md` — laporan ini.

Tidak mengubah JP, kalender, jadwal, implementasi TP/ATP, generator dokumen, Storage V5, data historis SD, atau sumber JSON SMP/SMA. Tidak mengubah repository V20.

## Risiko tersisa dan keputusan penutupan

Gap yang bisa dicocokkan sudah diimplementasikan sebagai sumber yang dipilih eksplisit. Penutupan penuh 38 kandidat **belum tercapai**: MAT/A memerlukan representasi resmi contoh bergambar yang utuh, BING/C memerlukan klarifikasi ketidaksesuaian identitas kelas pada sumber. Tidak mengarang perbaikan dan tidak memberi status VERIFIED pada keduanya.

84 sumber review SMP/SMA tetap UNVERIFIED; sembilan entri SD existing tidak diaudit ulang sebagai bagian penambahan ini. Label 046 existing untuk CODING_AI/B perlu audit terpisah. Perilaku historis 2024/2025/SUPERSEDED tetap baseline; integrasi ini tidak memperbaiki ketersediaan historis yang sejak awal UNRESOLVED. CP agama 020/2026 yang belum ada tidak diisi dari 046 secara otomatis.

Belum melakukan uji interaksi browser end-to-end, pemeriksaan visual aplikasi, atau panggilan provider AI langsung. Bukti Step 03–05 terbatas pada render/handler komponen dan kontrak data/validator dengan fixture. Build sukses tidak menyatakan pengujian UI/live-provider selesai. Perubahan masih lokal di main, belum commit/push.
