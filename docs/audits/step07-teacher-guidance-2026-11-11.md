# Step 07 — jalan penyelesaian manual setelah AI gagal

Baseline `ef0444d` pada main. Bukti: diagnostik pengguna build `build-2026-11-11T06:51:55.313Z-d625459a-d476-4ac3-811d-b4996116c2dd`; commit deployment tidak tersedia pada laporan.

## Akar masalah

- Diagnostik menunjukkan 7/9 Bab selesai, dengan tiga materi tanpa dukungan semantik: Sikap kuda-kuda, Teknik tendangan (Bab 4), Teknik dasar meluncur (Bab 7). Ada pula dua gap lokal TP/ATP pada Bab 4. Coverage global tidak menyelesaikan gap lokal ini.
- Riwayat memuat kegagalan kuota provider 429, timeout, serta proposal EDIT_MATERIAL yang ditolak. Tidak semuanya merupakan masalah koneksi: beberapa proposal belum memenuhi pemeriksaan kompetensi/substansi.
- `handleToggleMaterialTp` mencatat perubahan manual, tetapi tidak mencatat reviewedTitle/reviewedTpIds/reviewedTpFingerprint yang diwajibkan `hasTeacherMaterialSupport`. Centang bukan bukti atau tinjauan pedagogis yang lengkap.
- `renderInlineAlignment` sudah memiliki formulir tinjauan guru melalui `AlignmentProposalReview`, engine apply, histori, dan rollback, tetapi tidak pernah dipanggil di tampilan utama. Guru tidak dapat mengakses jalan penyelesaian itu.
- Sekalipun guru sudah mencatat bukti lengkap, `handleSave` sebelumnya mempertahankan sertifikat auto-repair yang belum COMPLETE. Validator tetap meminta analisis AI, meskipun seluruh persyaratan pedagogis telah dipenuhi manual.

## Perubahan minimal

- `ATPUnitMappingManager.tsx`: menampilkan panduan per materi belum selesai, TP kanonikal, usulan sebelum/sesudah dan alasan kegagalan yang terkait. Proposal checkpoint hanya ditampilkan jika fingerprint Bab dan sumber kanonikal cocok; tetap tersedia setelah reload tanpa panggilan AI. Proposal yang ditolak tidak dijadikan aksi otomatis atau dinyatakan valid. Formulir tinjauan existing ditampilkan di materi terkait. Gap klaim Bab diberi arahan mendukungnya melalui materi yang relevan atau menghapus klaim Bab yang tidak tepat.
- `atpMappingReadinessService.ts`: `finalizeTeacherReviewedMapping` menutup sertifikat tertunda hanya jika terdapat tinjauan guru eksplisit dan validator readiness lengkap dengan evaluateRepair sudah lolos. Menggunakan bukti/histori yang sama; tidak mengganti validator, meloloskan centang biasa, atau mengubah TP/ATP. `handleSave` menggunakan hasil ini dan menyinkronkan metadata UI setelah save berhasil.
- Fingerprint undo AI lama dipertahankan. Untuk metadata legacy tanpa fingerprint undo, pengaman eksplisit menonaktifkan undo snapshot AI lama; sertifikat validasi baru tidak memberi izin menghapus edit guru. Undo tinjauan/relasi existing tetap menggunakan histori masing-masing.
- Tidak ada perubahan prompt/algoritma AI, checkpoint, format import, engine pedagogis, atau storage. Checkpoint tidak direset. Tidak ada panggilan AI tambahan.

## Pengujian

`scripts/testStep07TeacherGuidance.tsx` memakai fixture proyek PJOK 9 Bab/27 materi, engine apply dan V5 sebenarnya, SSR UI dan handler Save aktual. Keputusan guru/proposal AI disimulasikan, bukan verifikasi Gemini live.

1. Formulir guru dan penjelasan gap Bab terlihat; centang biasa tetap tidak dapat memfinalisasi.
2. Proposal/alasan tersimpan terlihat setelah reload; perubahan sumber/TP menyembunyikan saran stale.
3. Tinjauan guru lengkap → Save aktual → V5 → reload → readiness Step 08 lolos tanpa AI.
4. Perubahan substansi setelah tinjauan dan ID TP tidak valid tetap gagal.

Hasil: PASS 4 skenario baru (termasuk proteksi undo legacy), PASS 8 suite regresi terkait, PASS TypeScript/lint (`tsc --noEmit`), PASS build frontend/server, PASS `git diff --check`. Build tetap memberi peringatan ukuran bundle besar. Suite regresi: auto-repair (29 skenario), semantic execution, inline alignment, target-unit (12 skenario), progress persistence (7 skenario), P1D4 mapping readiness, Step7–Step8 lineage, dan mapping persistence.

## Keterbatasan

Tidak ada pengujian Gemini live, sesi browser pengguna, atau deployment. Kuota 429 tidak dapat diselesaikan oleh perbaikan UI ini. Usulan AI yang ditampilkan tetap perlu ditinjau terhadap aktivitas yang benar-benar diajarkan; keberadaan usulan bukan bukti kebenaran. SSR/handler test bukan pengujian browser end-to-end.
