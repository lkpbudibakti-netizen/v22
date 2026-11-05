# Audit kesiapan Step 04–05 V21 — 2 November 2026

Checkout: `pkbmcwd92-cpu/Alco-Adm-v21-Penyesuaian-JP-dan-Jadwal`, branch lokal `main`. Perubahan belum di-commit atau di-push.

## Akar masalah terbukti

1. `validateAnalysisAI` dan `classifyCP4Issue` memakai daftar klasifikasi terpisah: `MU_INVALID` dianggap kualitas, sedangkan `PEDAGOGY_REVIEW` dianggap struktur. Callback `executeAIAnalysis` melaporkan semua issue sebagai `VALIDATION_FAILED`, termasuk kualitas saja. Klasifikasi sekarang dipusatkan; tiga kode review merupakan kualitas, placeholder/struktur tetap blocker. Jalur server CP4 menggunakan kontrak validasi bersama ini tanpa perubahan API/model.
2. `handleSave` mempertahankan `needsReview` dan referensi CP lama tanpa jalan penyelesaian. Peninjauan guru kini terikat snapshot CP aktif dan seluruh baris. Penyimpanan hanya melepas review dan memperbarui referensi bila validasi kanonikal serta empat kolom wajib lulus. Draft invalid mempertahankan review dan referensi lama.
3. `planCP4Repair` menambahkan baris untuk setiap peringatan cakupan kosakata, termasuk parafrasa. Sekarang memperbaiki baris elemen yang sudah ada; baris baru hanya untuk elemen yang belum terwakili. Respons penuh dengan duplikat identik ditolak; perbaikan tetap memakai ID target.
4. Stale TP/ATP digantungkan pada kesiapan induk, sehingga stale yang benar bisa tersembunyi saat induk blocked. Deteksi kini terpisah dari gating; modul tanpa baris tidak dianggap stale. Banner menampilkan modul dan alasan, serta otomatis mengikuti laporan dependensi terbaru. WorkflowStepper juga menerima workspace dalam validasi.
5. Setiap save selalu mengganti waktu analisis, walaupun isi dan metadata dependensi sama. App mempertahankan timestamp untuk no-op yang sama persis setelah metadata generasi diabaikan. Save membaca ulang baris dan status sebelum mengembalikan sukses; editor di-remount berdasarkan tahun/profil.

## File berubah

- `src/services/cpAnalysisAIContract.ts`: klasifikasi bersama, placeholder, pemeriksaan variasi akhiran `nya`, duplikat respons, mempertahankan teks berkualitas-review dalam draft.
- `src/services/cpAnalysisDraft.ts`: klasifikasi, ID/placeholder, rencana perbaikan tanpa baris berulang.
- `src/services/cpAnalysisAIDiagnostics.ts`: klasifikasi default sesuai kode.
- `src/components/CPAnalysisManager.tsx`: kualitas terpisah dari kegagalan, review CP aktif, validasi sesudah apply/saat save, pesan tersimpan versus SIAP.
- `src/App.tsx`: pembacaan ulang, no-op timestamp, pemisahan editor antar konteks.
- `src/services/workflowEngine.ts`: stale tetap akurat saat blocked; modul belum dibuat tidak stale.
- `src/components/WorkflowStepper.tsx`: konteks workspace dan rincian penyebab.
- `scripts/testStep04ReadinessV21.ts`: fixture BINDO Fase A empat elemen dari sumber resmi yang sudah ada di repo, delapan skenario dan pemeriksaan kosakata.
- `scripts/testStep4MeaningfulUnderstandingRegression.ts`: binding harness untuk validasi baru.
- `scripts/helpers/appCPAnalysisSaveContract.ts`: mock pembacaan ulang pada callback App aktual.

`cpWorkflowService.ts`, server CP4, sumber CP resmi, model Gemini, API, dan Storage V5 tidak diubah. Validator workflow yang ada tetap dipakai; validasi empat kolom tambahan dibatasi pada penyelesaian Step 04 agar kontrak modul lain tetap terjaga.

## Regresi wajib

| Kasus | Hasil | Batas bukti |
|---|---|---|
| Respons Gemini fixture dengan 8 MU_GROUNDING_REVIEW | PASS | Handler server, provider mock; delapan kualitas dan success=true |
| Pilih rekomendasi, terapkan, simpan SIAP | PASS | Proposal dan callback save aktual; callback App baca ulang diuji terpisah |
| Review CP lama menjadi SIAP dengan referensi terbaru | PASS | Callback save aktual, snapshot guru cocok |
| CP berubah tetapi belum diselaraskan | PASS | Tetap blocked; invalid tetap review dan timestamp lama |
| Perbaikan berulang tanpa baris duplikat | PASS | Tiga perbaikan berturut-turut mempertahankan ID/jumlah baris |
| TP/ATP stale tetap dilaporkan | PASS | Mesin dependensi, termasuk induk blocked |
| Semua dependensi valid, banner tidak diperlukan | PASS | hasStaleModules=false |
| Pemisahan profil/tahun | PASS | Kontrak key editor, runtime CP/TP, Storage V5; klik UI belum diuji |

## Batas runtime dan risiko

- Belum menjalankan browser: klik nyata Perbaiki → pilih → Terapkan → Simpan → Lanjut Step 05, tampilan blocker/banner/toast, dan pergantian profil/tahun secara visual masih perlu smoke test.
- Tidak memanggil Gemini live. Bukti provider memakai fixture/mock, bukan klaim keluaran produksi.
- Pemeriksaan kosakata tetap konservatif dan dapat memberi temuan kualitas pada parafrasa. Materi tambahan tetap ditandai untuk peninjauan guru, tanpa menonaktifkan validasi struktur.
- No-op timestamp hanya dipertahankan untuk kesamaan konservatif; perubahan isi, status atau referensi dependensi tetap dapat membuat modul hilir stale.
- Build memberi peringatan ukuran bundle besar; bukan kegagalan build.

## Hasil suite tambahan

| Perintah/suite | Hasil akhir |
|---|---|
| `npm.cmd run lint` (typecheck) | PASS |
| `npm.cmd run build` (Vite + bundle server + PWA) | PASS |
| `testStep04ReadinessV21.ts` | PASS |
| `testStep4MeaningfulUnderstandingRegression.ts` | PASS |
| `testStep4FinalCheckWorkflow.ts` | PASS |
| `testStep4DownstreamCompatibility.ts` | PASS |
| `testCPAnalysisSemanticReviewRegression.ts` | PASS |
| `testStep4HardeningRegression.ts p0` | PASS |
| `testStep4HardeningRegression.ts p1` | PASS setelah perbaikan hint klausa pada target baris lama |
| `testStep4HardeningRegression.ts p2` | PASS setelah mempertahankan target kolom sempit |
| `testStep4HardeningRegression.ts p3` | PASS |
| `testStep4DeadlineRegression.ts` | PASS |
| `testStep4GatewayAndBudgetRegression.ts` | PASS |
| `testMerdekaV5CPAnalysisRuntime.ts` | PASS |
| `testMerdekaV5TPRuntime.ts` | PASS |
| `testWorkflowDependencyRegression.ts` | PASS |
| `testMerdekaCanonicalWorkflowRegression.ts` | PASS |
| `testStorageV5AnnualCrud.ts` | PASS |
| `testStorageV5Contract.ts` | PASS |
| `testStorageV5HierarchyCrud.ts` | PASS |
| `testStorageV5HierarchyDelete.ts` | PASS |
| `testStorageV5HierarchyDuplicate.ts` | PASS |
| `testStorageV5MasterDataCrud.ts` | PASS |
| `testStorageV5Persistence.ts` | PASS |
| `testStorageV5RelationalIntegrity.ts` | PASS |
| `testStorageV5SemesterCrud.ts` | PASS |

Kegagalan selama iterasi telah ditangani: binding harness baru yang belum tersedia; pemeriksaan empat kolom yang sempat mengubah kontrak validator lintas modul (dipindah kembali ke Step 04); dan dua regresi hardening target/hint klausa di atas. Hasil akhir tidak menonaktifkan validasi atau melonggarkan assertion lama.
