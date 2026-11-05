# Audit lanjutan gap CP V21 — 1 November 2026

Repository `pkbmcwd92-cpu/Alco-Adm-v21-Penyesuaian-JP-dan-Jadwal`, branch `main`, baseline `409a48ffe8f34bc23b522279d0f6cd775aeed772`. Perubahan lokal; belum commit/push.

## Keputusan per gap

| Gap | Sebelum | Hasil audit dan perubahan |
|---|---|---|
| Matematika SD A | Kandidat ditahan karena contoh bergambar hilang dari ekstraksi | Ditambahkan satu sumber VERIFIED melalui pool pilihan eksplisit existing. Lima elemen lengkap, teks ekstraksi asli, gambar asli X196, nomor elemen, hash, halaman dan transkripsi visual dipertahankan. Tidak mengganti CP historis atau CP guru otomatis. |
| Bahasa Inggris SD C | UNVERIFIED / karantina | Tetap ditahan. PDF 134 menulis Fase C tetapi kelas III/IV, serta `Listening - Writing` pada elemen Menyimak–Berbicara. Salinan resmi daring identik dengan PDF lokal. Tidak ada dasar untuk mengoreksi menjadi kelas V/VI atau mengganti terjemahannya secara asumtif. |
| Coding & AI SD B | RESOLVED / UNVERIFIED dari entri lama | Tidak lagi ditawarkan sebagai sumber resmi: UNRESOLVED dengan alasan audit. CP 046 Lampiran II hanya menyediakan SD Fase C; struktur Permendikdasmen 13/2025 menyediakan mapel pilihan ini pada kelas V/VI, bukan III/IV. Teks dua elemen pada entri B tidak terbukti sebagai CP resmi. |
| Agama SD 2026/2027 | Enam entri A UNVERIFIED; B/C belum tersedia | Audit sumber 020 selesai pada identitas regulasi, cakupan dan ketersediaan blok fase. Metadata penerbit, judul, URL resmi dan tanggal berlaku diperbaiki. Tidak mempromosikan enam entri A dan tidak mengisi B/C dari 046/2025. Penutupan substansi CP 020 di registry belum selesai. |
| CI `handleSaveCPAnalysis` | Dua tes mencari signature tanpa anotasi return; salah satunya masih menuntut no-op | Kedua tes diperbarui untuk mengeksekusi callback App yang sebenarnya dan memeriksa kontrak boolean/guard/persistensi canonical. App dan Storage V5 tidak diubah. |

**Jumlah sumber SD tambahan sekarang 37: 36 sebelumnya tetap identik, ditambah Matematika A.** Dari dua kandidat karantina awal, satu sudah ditutup dan satu (BING/C) masih terbuka. Berkas karantina awal tetap menjadi snapshot audit, bukan daftar runtime; MAT/A yang aktif berasal dari supplement baru.

Metadata Coding B pada baseline sebenarnya `REG-PERMENDIKDASMEN-13-2025`, **bukan** `DEC-BSKAP-046-2025` seperti dugaan dalam laporan sebelumnya. Tidak menggantinya dengan identitas regulasi CP yang dikarang. Entri mentah historis tetap identik di `sd.ts`; koreksi authority diterapkan sebagai pengecualian audit ketika resolver memilih sumber. Mapel tetap ada dalam katalog untuk CP manual. Perubahan resolver terbatas pada satu ID tersebut, termasuk saat pool diberikan eksplisit.

## Bukti sumber

1. PDF pengguna `E:/Downloads/Kumpulan%20CP.pdf`, SHA-256 `f8e5f478de4dc1790bfc800104135f992c8fe6cb2d8f770f46b616932a2aec34`. Salinan [046/2025 dari portal resmi](https://kurikulum.kemendikdasmen.go.id/file/1753929861_manage_file.pdf) diunduh kembali pada audit ini dan **hash-nya identik**. MAT/A: PDF fisik 111–112; BING/C: 134–135; Koding/KA C: 342–343.
2. [Permendikdasmen 13/2025, PDF resmi](https://kemendikdasmen.go.id/download/file/1400), SHA-256 `8153c74577d0b7a9f2dfc7f41d3096bc0882d796cc2f26ddea5f6c0d80f44c7a`. PDF fisik 18–19 memuat struktur kelas III–IV tanpa pilihan Koding/KA; tabel kelas V mulai PDF 19–20 dan kelas VI pada 21–22 memuat pilihan tersebut. Ini dasar struktur mapel, bukan sumber redaksi CP dua elemen pada entri B.
3. [Salinan resmi Keputusan Kepala BKPDM 020/2026](https://kurikulum.kemendikdasmen.go.id/service/download.php?kategori=rujukan&id=142), ditemukan melalui daftar dinamis [Regulasi Kurikulum](https://kurikulum.kemendikdasmen.go.id/rujukan/regulasi-kurikulum), SHA-256 `598278746b0f62333fdcab520d5dd4c1a9650c94bd3906acff4254100976552b`, 79 halaman berupa scan. Halaman 1 menetapkan identitas **Badan Kebijakan Pendidikan Dasar dan Menengah**; halaman 3, diktum KESATU mengganti CP Agama/Budi Pekerti termasuk pendidikan khusus; diktum KEDUA berlaku pada tanggal ditetapkan, **11 Juni 2026**. Lampiran I halaman 4–44 adalah pendidikan umum, Lampiran II mulai 45 adalah pendidikan khusus. Keduanya tidak dicampur.
4. [Siaran pers resmi 23 Juni 2026](https://www.kemendikdasmen.go.id/siaran-pers/15636-capaian-pembelajaran-baru-telah-terbit-yang-berubah-hanya-mata-pelajaran-agama-dan-budi-pekerti) mendukung bahwa perubahan 020 terbatas pada Agama/Budi Pekerti, sedangkan mapel lain tetap mengacu 046.

### Matematika A: pelestarian gambar

Gambar X196 pada PDF 112 diekstrak sebagai PNG 229×78 tanpa menggambar ulang. Pemeriksaan membandingkan **piksel asli**, dimensi dan hash aset. Gambar berisi tiga lingkaran, masing-masing tujuh titik, dengan susunan kelompok 3+4, 2+5, dan 1+6 yang dihubungkan tanda sama dengan.

Representasi teksnya adalah `(●●● | ●●●●) = (●● | ●●●●●) = (● | ●●●●●●)`. Ini **transkripsi visual**, bukan kalimat CP baru. Teks sumber asli tetap di `sourceText`/`extractedText`; gambar asli, alt text, transkripsi, halaman dan hash disimpan terpisah dalam metadata `sourceReview.figures`. Konten Aljabar menyertakan transkripsi tepat setelah `Contoh:` agar konsumen teks tidak menerima contoh kosong. Tidak memperbaiki ejaan resmi `Menunjukan` atau mengubah substansi elemen lain.

Step 03 menampilkan gambar asli dan menandai transkripsi sebagai representasi visual. Pemilihan sumber hanya mengisi draft; penyimpanan tetap tindakan eksplisit. Storage V5 existing mampu mempertahankan metadata tambahan tersebut tanpa perubahan implementasi. Generator dokumen tidak diubah: bukti audit ini tidak menjamin ekspor DOCX/PDF menggambar ulang contoh sebagai raster; jalur kontennya membawa transkripsi teks dan metadata gambar tetap tersedia.

### Ketersediaan Agama SD menurut 020/2026

Nomor halaman berikut adalah halaman PDF fisik, dan membuktikan keberadaan blok fase dalam **sumber resmi**, bukan verifikasi redaksi entri aplikasi.

| Mapel | Halaman A | Halaman B | Halaman C | Registry 2026/2027 |
|---|---|---|---|---|
| PAI | 6–7 | 7 | 7–8 | A RESOLVED/UNVERIFIED; B/C UNRESOLVED |
| PAK | 12 | 13 | 14 | A RESOLVED/UNVERIFIED; B/C UNRESOLVED |
| PKAT | 20–21 | 21–22 | 22–23 | A RESOLVED/UNVERIFIED; B/C UNRESOLVED |
| PHINDU | 29 | 29 | 29 | A RESOLVED/UNVERIFIED; B/C UNRESOLVED |
| PBUDDHA | 34–35 | 35–36 | 36 | A RESOLVED/UNVERIFIED; B/C UNRESOLVED |
| PKHONGHUCU | 40–41 | 41–42 | 42 | A RESOLVED/UNVERIFIED; B/C UNRESOLVED |

Naskah 020 resmi sekarang tersedia dan blok A–C ditemukan untuk keenam agama. Namun enam entri A existing bukan transkripsi resmi utuh yang sudah dicocokkan: misalnya PAK A bawaan hanya dua elemen, sedangkan sumber halaman 12 memiliki empat elemen dengan subelemen. Ketersediaan resolver **tidak berarti VERIFIED**. Ada 12 kombinasi B/C yang belum mempunyai entri 020 SD, dan 6 A masih membutuhkan penggantian berbasis transkripsi terverifikasi melalui pekerjaan terpisah yang menjaga data guru. Tidak menyebut regulasi 020 tidak tersedia dan tidak mengisi kekosongan dengan AI/OCR yang belum diperiksa.

Metadata tahun implementasi 2026/2027 tetap mengikuti registry existing; tanggal berlaku hukum 11 Juni 2026 dicatat sebagai fakta terpisah, bukan dipakai untuk mengarang rentang tahun ajaran baru. Seluruh sumber agama 046 tambahan tetap berhenti pada 2025/2026. Tidak ada fallback otomatis ke 046 untuk 2026/2027.

## Pengujian

Lingkungan eksekusi: Windows lokal, Node 24.20.0. Perintah CI berikut dicerminkan secara lokal; **bukan klaim job GitHub Actions Ubuntu/Node 22 sudah dijalankan**.

- `testMerdekaV5AnnualCPRuntime.ts`: PASS **10/10**.
- `testMerdekaV5CPAnalysisRuntime.ts`: PASS **12/12**. Helper AST mengeksekusi callback App nyata: tahun/CP tidak tersedia → false/tanpa write; berhasil → canonical year/CP/id/timestamp + refresh + true; kegagalan simpan → false/notifikasi; input editor tidak dimutasi. Tidak bergantung pada whitespace atau anotasi return type.
- `testCP046SDIntegration.ts`: PASS semua 38 kandidat, kini 37 sumber aktif/1 ditahan, SD A–C pada tiga tahun ajaran, kontrak Step 03→04→05 dengan fixture, identitas dan Storage V5/reload. Snapshot historis dan 84 SMP/SMA tetap identik; hash hasil resolver dibandingkan dengan mengecualikan satu ID Coding B yang memang ditolak audit. Hash baseline lama tetap disimpan, tidak diganti diam-diam.
- `testCPGapFollowup.tsx`: PASS gambar/hash/dimensi/transkripsi, render komponen Step 03, apply callback ke draft, metadata gambar bertahan saat reload, teks guru/TP/ATP tidak berubah, Coding B UNRESOLVED, BING C tetap ditahan, 18 konteks Agama A–C tanpa fallback 046. Hash JSON **dan semua 36 record runtime** identik baseline. Komponen hanya dapat memuat aset gambar bawaan yang cocok manifest, bukan URL arbitrer dari metadata impor.
- `auditCPGapSource.py` terhadap PDF pengguna: PASS hash PDF, lima blok teks MAT A lengkap, kesamaan piksel gambar asli, hash aset, dan anomali BING C tetap sesuai sumber.
- `testCP046CompatibilityRegression.ts` dengan `CP_COMPAT_BASE=409a48f`: PASS **1.745 konteks** serta draft/persistensi/consumer compatibility. Loader baseline diperbaiki untuk JSON dan default import; perbandingan menerima hanya pengecualian Coding B dan metadata 020 yang terbukti berubah. Tes ini tidak ditambahkan ke CI dangkal yang mungkin tidak mempunyai commit baseline.
- PASS: subject dropdown, CP046 review integration, CP046 safety, CP source-search runtime dan PJOK SD resolver.
- PASS: fixture `testStep4DownstreamCompatibility.ts` Step 03–10, dua semester, validator/proyeksi/reload/ZIP. Tidak mengklaim semua ekspor sempurna: fixture existing masih melaporkan DOCX PEMETAAN_ATP_UNIT blocked dan peringatan lebar tabel; tidak dilakukan perbandingan output baseline lintas commit untuk perintah ini.
- PASS: 17 dari 18 skrip CI penyimpanan/runtime terkait yang dijalankan: MasterData CRUD, Hierarchy CRUD/Delete/Duplicate, Annual CRUD, Semester CRUD, Persistence, RelationalIntegrity, RuntimeV5, Contract, F1 AnnualSemesterScope, AppShell, AnnualCPRuntime, CPAnalysisIntegrity, CPAnalysisRuntime, TPRuntime, ATPRuntime.
- `npm.cmd run build` setelah perubahan implementasi final: **PASS, exit 0**, meliputi Vite, PWA dan server bundle. Masih ada peringatan ukuran chunk >500 kB. `git diff --check` lulus.

Kegagalan yang tetap dilaporkan:

- `testMerdekaV5SemesterNavigation.ts`: FAIL pada assertion statis ATP `onNextStep` harus memanggil `setCurrentStep('semester')`. Direproduksi pada worktree **409a48f yang tidak diubah** dengan kegagalan sama. Tidak memperbaiki App/Step 07–08 di luar lingkup.
- `testCurriculumMaster.ts`: FAIL pada assertion CP historis 2024/2025 harus menggunakan 032/2024. Direproduksi pada worktree **409a48f yang tidak diubah** dengan kegagalan sama. Dua assertion metadata 020 diperbarui mengikuti sumber yang kini terbukti, tetapi suite masih berhenti pada kegagalan historis sebelumnya.
- Typecheck `tsc --noEmit --pretty false`: exit 2, **67 diagnostik**. Output sebelum/sesudah identik, tanpa diagnostik baru. Bukan typecheck bersih dan bukan seluruh CI hijau.

Dua pengujian CP baru ditambahkan ke workflow Storage V5 Regression. Bagian CI lain di luar rangkaian terkait di atas tidak diklaim lulus. Tidak melakukan panggilan AI/provider langsung atau pengujian klik browser end-to-end; bukti Step 03–05 adalah render/callback/validator dan fixture lokal.

## Batas perubahan dan file

Tidak mengubah `src/App.tsx`, Storage V5, CP historis `sd.ts/smp.ts/sma.ts`, JSON 36 sumber SD existing, JSON review SMP/SMA, atau implementasi Step 07–08. Tidak melakukan merge V20 atau menulis repository V20.

File implementasi: `src/data/curriculum/cp/sd046.ts`, `types.ts`, `index.ts`, `sourceAudit.ts`, `sources/cp-sd-bskap-046-2025-visual-supplement.json`, `src/data/curriculum/regulations.ts`, `src/components/CPManager.tsx`, `CPSourceFigures.tsx`, dan `public/curriculum/cp046/sd-a-mat-aljabar-p112.png`.

File pengujian/dokumentasi: dua tes runtime CP, helper `scripts/helpers/appCPAnalysisSaveContract.ts`, `testCP046SDIntegration.ts`, `testCPGapFollowup.tsx`, `testCP046CompatibilityRegression.ts`, dua assertion 020 pada `testCurriculumMaster.ts`, fixture hash `scripts/fixtures/cpGap409a48fBaseline.json`, tambahan hash resolver terfilter pada `docs/cp046-sd-v21-baseline.json`, `scripts/auditCPGapSource.py`, workflow `.github/workflows/storage-v5-regression.yml`, dan laporan ini.

## Risiko dan pekerjaan tersisa

MAT/A ditutup pada data CP, gambar sumber dan jalur teks. BING/C belum dapat dinyatakan sah untuk kelas V/VI tanpa klarifikasi/koreksi resmi; kelas dan label bahasa Inggris tidak diubah berdasarkan dugaan. Coding B tidak mempunyai sumber CP resmi yang terverifikasi dan tetap jalur manual, bukan dialihkan ke Fase C. Substansi 020 membutuhkan integrasi terverifikasi tersendiri (enam A dan dua belas B/C); enam A existing tetap UNVERIFIED, bukan diakui sebagai redaksi resmi utuh. Seluruh data guru lama tetap dipertahankan.
