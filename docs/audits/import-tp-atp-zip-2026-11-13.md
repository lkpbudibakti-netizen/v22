# Audit impor proyek → TP → ATP → ZIP

Tanggal: 13 November 2026. Branch: main. Baseline: 33c7e09acf2b35ea9ddfda371e9e0a800c78ccfc.

## Akar masalah dan perubahan

- `src/services/tpSemanticFidelity.ts:getUncoveredTPChunks/checkTPSemanticFidelity`: cakupan dihitung dari union token dan ambang overlap; seluruh fragmen dilaporkan belum tercakup, termasuk kata yang sebenarnya sudah terwakili. Ini bukan bukti kecukupan semantis. Sekarang diagnostik memisahkan sinyal terwakili dan bagian yang perlu ditinjau. Parafrasa yang tidak dapat dipastikan otomatis dapat ditinjau guru dengan alasan spesifik yang terikat fingerprint isi TP dan butir Analisis CP. Ketiadaan TP rujukan, konflik kompetensi yang terdeteksi, rumusan duplikat/tidak konsisten dan kegagalan struktural tetap mengunci. Tinjauan tidak dapat mengesampingkan konflik kompetensi eksplisit.
- `src/components/TPManager.tsx:handleConfirmAlignment`: tombol konfirmasi sebelumnya hanya ada dalam banner needsReview. TP impor dengan kode valid namun workflowStatus DRAFT tidak selalu mendapat jalur konfirmasi yang terlihat. Tombol **Validasi & Konfirmasi TP** sekarang selalu tersedia untuk daftar TP, AI opsional. Validitas kode, catatan substansi, dan status tersimpan dipisahkan. Rumusan, kode, Stable ID, urutan dan lineage tidak diganti saat konfirmasi. Kekurangan ditampilkan di halaman serta dapat diperbaiki lewat editor manual existing.
- `TPManager.tsx:handleGenerateAI`: kandidat sebelumnya menghapus needsReview sebelum guru meninjau dan dapat langsung disimpan pada daftar kosong. Semua hasil kini preview saja, menampilkan isu validator, dan belum SIAP sebelum diterapkan serta dikonfirmasi guru. Preview stale tetap ditolak. Konfirmasi tidak melewati validator CP/Analisis CP.
- `server.ts:/api/ai/generate-tp`: prompt diperjelas agar memakai jumlah minimum TP yang memadai, kalimat alami, dan tidak memecah contoh/koma hanya demi token. `server/curriculumFallback.ts`: rekomendasi sumber yang lengkap diprioritaskan daripada dekomposisi mekanis; tidak menambah tuntutan sikap generik yang tidak berasal dari sumber, dan konjungsi dibuat lebih alami. Draft fallback tetap wajib ditinjau, bukan sertifikat kualitas AI.
- `TPManager.tsx:persistTP/handleConfirmAlignment`: menyimpan ulang status/konfirmasi sebelumnya selalu mengganti updatedAt, sedangkan ATP/Step 07 memakai timestamp itu untuk stale. Timestamp dipertahankan jika isi dan parent CP/Analisis CP tetap sama; perubahan isi/parent tetap memperbaruinya. Aturan dependensi global tidak dilonggarkan.
- `src/services/identityOnlyProjectExport.ts:buildImportedProjectExportContext` menghasilkan `skipDownload:true` untuk komposisi dokumen. Konteks itu terbawa ke `administrationProjectImportService.ts:importCompleteAdministrationProjectAndExport` dan handler unduh `CompleteProjectImportModal.tsx`; engine membuat zipBlob tetapi melewati satu-satunya saveAs. Kedua tindakan unduh dari impor kini mengirim salinan konteks dengan skipDownload:false. Kebijakan global tidak diubah; berkas individual tetap silent. Hasil tanpa zipBlob menjadi exportError. Guard submitting mencegah klik ganda; catch/finally tetap menampilkan galat dan membuka kembali tombol. Impor yang sudah tersimpan tidak diulang/dihapus saat ZIP gagal.

## Data dan kompatibilitas

`TPData.substanceReviews` bersifat opsional; tidak ada migrasi/reset. Validator workflow existing menerima tinjauan guru hanya untuk sumber dan TP yang fingerprint-nya masih sama. Perubahan rumusan/rujukan membatalkan tinjauan terkait. Review draft di UI juga terikat isi saat alasan diketik, sehingga tidak otomatis dipakai untuk isi yang berubah kemudian. Tidak ada engine atau sistem penyimpanan kedua. CP/TP/ATP pengguna tidak diganti otomatis; tidak ada perubahan validator Step 07/08 atau logika modul ajar.

## Pengujian

- `testImportedTPConfirmation.tsx`: handler komponen aktual dengan hook deterministik; arsip representatif diimpor melalui layanan aktual. TP valid dikonfirmasi tanpa AI → ATP; kode/ID/rumusan/urutan/lineage utuh; V5 save/reload dan readiness Step 07 tetap valid. TP kurang lengkap tetap gagal; revisi manual dapat lolos. Parafrasa dengan alasan guru dapat disimpan/reload; fingerprint usang, ID fiktif, konflik kompetensi, preview invalid, dan daftar awal kosong tidak memberi SIAP palsu. Tidak mengklaim browser atau Gemini live.
- `testIdentityOnlyDuplicationRegression.tsx`: ZIP aktual memakai renderer PDF/DOCX; saveAs ditangkap pada batas browser dan arsip dibuka untuk diperiksa. Impor sekali → unduh sekali; unduh ulang dengan dua klik bersamaan → tepat satu unduhan. ZIP gagal → role alert dan tombol aktif; exportError mempertahankan hasil impor.
- `testBindo6TPCodeCoverageRegression.ts`: fixture Bahasa Indonesia kelas 6, 13 butir analisis, kode/lineage/stable regeneration dan cakupan berbicara/presentasi.
- `testP0CAtpSemanticFidelityRegression.ts`: regresi substansi/kompetensi ATP serta ID dan cakupan kanonikal.
- `testRecoveryT1TPRuntimeRegression.ts`: 45/45. Fixture lama dilengkapi parent CP, timestamp, elementId/cpText kanonikal dan metadata kompetensi yang sesuai agar tes fase tidak gagal karena dependensi fixture yang belum lengkap. Validator aplikasi tidak dilemahkan.
- Pengujian dokumen pertama terkena EBUSY pada berkas QA yang masih dikunci Word dari sesi sebelumnya. Opsi direktori keluaran `V22_PRINT_AUDIT_DIR` ditambahkan ke skrip QA, lalu kelompok documents diulang dengan folder terpisah. Tidak menutup Word pengguna dan tidak mengubah renderer aplikasi.

Reproduksi: `npm.cmd run test:import-tp`; `npm.cmd exec tsx scripts/testIdentityOnlyDuplicationRegression.tsx`; `npm.cmd run ci:tests -- all`; `npm.cmd run lint`; `npm.cmd run build`. Pada mesin dengan artefak Word terkunci, set `V22_PRINT_AUDIT_DIR` ke folder QA baru sebelum CI documents.

## Keterbatasan

Tidak ada arsip kasus produksi baru yang diberikan pada permintaan ini; pengujian menggunakan fixture representatif dan handler aktual. Gemini live dan dialog unduhan browser belum diuji. Guard deterministik tidak membuktikan seluruh kualitas bahasa/semantik model; guru tetap menilai parafrasa lewat alasan spesifik. Alasan manusia yang keliru secara pedagogis tidak dapat selalu dideteksi otomatis. Render pagination DOCX native tidak menjadi klaim audit ini. Build masih memberi peringatan ukuran chunk existing. Data proyek tidak disunting diam-diam untuk membuat status SIAP.

## File berubah
- `docs/audits/import-tp-atp-zip-2026-11-13.md`
- `package.json`
- `scripts/ci/test-groups.json`
- `scripts/testBindo6TPCodeCoverageRegression.ts`
- `scripts/testBlankIdentityExport.ts`
- `scripts/testIdentityOnlyDuplicationRegression.tsx`
- `scripts/testImportedTPConfirmation.tsx`
- `scripts/testRecoveryT1TPRuntimeRegression.ts`
- `server.ts`
- `server/curriculumFallback.ts`
- `src/components/CompleteProjectImportModal.tsx`
- `src/components/TPManager.tsx`
- `src/services/administrationProjectImportService.ts`
- `src/services/cpWorkflowService.ts`
- `src/services/tpSemanticFidelity.ts`
- `src/types/index.ts`

