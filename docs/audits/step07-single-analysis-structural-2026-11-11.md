# Step 07 — satu analisis AI, kelulusan struktural

Baseline main: `0bf7488c1ba9416ae003bcc8fdb7b59f4af01144`. Kebijakan baru menggantikan gerbang bukti semantik sebelumnya. Tidak ada Gemini live pada pengujian ini.

## Akar masalah dan perubahan per file

| File | Perubahan |
| --- | --- |
| `atpMappingReadinessService.ts` | Hapus gerbang `hasTeacherMaterialSupport`, SEMANTIC_EVIDENCE_MISSING, outcome dan verifiedFingerprint. Readiness hanya berasal dari struktur/lineage kanonikal, coverage, sumber SIAP, identitas dan stale. Adapter finalizeTeacherReviewedMapping dipertahankan sebagai no-op agar pemanggil lama tidak perlu migrasi; metadata TIMEOUT tidak diubah agar terlihat sukses. |
| `atpUnitMappingValidationService.ts` | Tidak lagi mengubah isValid berdasarkan checker semantik judul. Semua pemeriksaan ID, referensi, subset materi/Bab, TP–ATP, coverage global/lokal, urutan/struktur tetap berlaku. Field semanticConflicts lama tetap kompatibel, bukan gerbang. |
| `step07AutoRepairService.ts` | PROPOSE → FILTER → APPLY → VALIDATE → SAVE tanpa panggilan VERIFY. Tidak membuat sertifikat semantik baru. Guard biaya, retry/stagnasi, timeout, source freshness, snapshot dan undo tetap digunakan. GLOBAL dapat menutup TP/ATP uncovered melalui relasi lokal yang relevan, tanpa mengulang masalah lokal BLOCKED; sebelumnya filter global menolak seluruh aksi lokal meskipun diperlukan untuk cakupan global. |
| `step07AutoExecutionPolicy.ts` | Permit terikat source fingerprint dan Bab aktif. Menolak aksi di luar whitelist (termasuk DELETE), ID Bab/materi/TP tidak sah, TP tanpa induk ATP, before stale, ID tindakan duplikat, judul kosong dan aksi lintas Bab pada mode per-Bab. `checks` lama opsional dan tidak memberi/menghalangi izin. Helper receipt lama hanya untuk kompatibilitas histori/backup. |
| `mappingAlignmentService.ts` | evidence menjadi opsional. Apply tidak lagi memerlukan kutipan TP/materi, verba kompetensi atau persetujuan bukti. Masih clone-then-validate, derivasi ATP deterministik, validasi struktur, cakupan, konflik aksi, rollback dan history. UI resolution mengikuti relasi struktural, bukan receipt. Klasifikasi approval legacy di luar jalur scoped tidak diperluas secara global. |
| `server/mappingAnalysis.ts` | Prompt satu respons meminta pilihan relasi masuk akal berdasarkan mapel, Bab, materi dan TP/ATP. Alasan relevansi singkat, perubahan minimal, tanpa aktivitas/asesmen, evidence, sertifikat atau instruksi VERIFY. |
| `server/mappingMinimalAnalysis.ts`, `mappingBabFirstAnalysis.ts` | Preview dan findings tidak mensyaratkan receipt/persetujuan pedagogis. Parser tetap menolak bentuk konflik, ID palsu, lineage rusak dan sumber stale. ATP induk diperoleh dari TP kanonikal. Peringatan relevansi dari analisis bukan pembuktian kompetensi atau gerbang readiness baru. |
| `step07HybridRepairService.ts` | Cache PROPOSE lama dapat dilanjutkan langsung meskipun checkpoint dahulu berhenti di VERIFY. Tidak menjalankan verifikasi kedua. Mapping tersimpan lengkap menjadi no-op tanpa AI/save/reset checkpoint, termasuk outcome TIMEOUT/NEEDS_TEACHER_REVIEW. Cache rusak/obsolete diabaikan hanya untuk asesmen read-only V5 yang tidak perlu perbaikan, dengan raw cache tetap utuh; freshness/CAS tetap diperiksa. Proses perbaikan yang benar-benar membutuhkan cache tetap fail-closed bila cache rusak. |
| `storageV5.ts` | Hapus pemeriksaan sertifikat saat menerima run baru. Pemeriksaan canonical, identitas, source CAS, versioning, dan validasi struktur/readiness untuk klaim COMPLETE tetap berlaku. |
| `ATPUnitMappingManager.tsx` | Tidak meminta ACC/bukti pada alur pemetaan otomatis. Saran bagi relasi belum lengkap diarahkan ke editor TP/ATP. Status kesiapan aktual mengungguli metadata NEEDS_TEACHER_REVIEW. Navigasi tetap melakukan save bila draf berubah, menolak save gagal, serta mengunci draf auto-repair belum tersimpan. Konfirmasi penggantian seluruh draft pada generator awal tetap melindungi materi guru. |
| `step07FullDiagnosticReport.ts` | Workflow satu analisis dan validasi struktural dinyatakan eksplisit; VERIFY dan outcome lama dibaca sebagai histori, bukan blocker independen. |

## Data dan batas scope

Tidak ada perubahan CP/TP/ATP kanonikal, format Excel, schema proyek V5, atau logika penyusunan modul ajar/Step 08. Histori, backup, rollback dan namespace profil tetap digunakan. Status proses lama boleh tetap TIMEOUT walaupun data tersimpan sudah siap. Pembuktian kegiatan/asesmen tetap berada pada modul ajar.

Readiness menilai kelayakan kandidat. Untuk benar-benar berpindah halaman, controller existing tetap mensyaratkan keberhasilan save; V5 yang dikonsumsi Step 08 adalah snapshot tersimpan. Kegagalan save tidak dilaporkan sebagai persisted/saved dan draf auto-repair tetap terkunci hingga tersimpan.

## Pengujian

Tes yang menuntut receipt, kutipan atau panggilan VERIFY diganti/disesuaikan dengan kebijakan baru. Tidak menggunakan skip untuk meloloskan persyaratan lama. Suite single-analysis dan checkpoint menguji kontrak baru, sedangkan tes import, rollback, stale, per-Bab, storage, navigasi, timeout, observabilitas dan downstream tetap dijalankan. Fixture helper baru hanya untuk tes, bukan engine aplikasi.

- Meluncur → E1-SKG-01/02 dalam satu respons, tanpa evidence/rename; judul dan Bab lain tetap sama; V5 reload siap.
- Pemetaan valid + TIMEOUT/NEEDS_TEACHER_REVIEW, tanpa sertifikat, tidak memanggil AI atau menulis ulang checkpoint.
- ID palsu, pasangan TP–ATP salah, coverage kurang, sumber belum SIAP, stale, aksi luar Bab dan aksi DELETE ditolak.
- Kegagalan save tidak membuka navigasi; budget request/input/output dan timeout mempertahankan snapshot aman.
- Resume setelah interupsi ANALYZE/PROPOSE/APPLY/VALIDATE/SAVE tidak mengulang analisis yang sudah tersimpan. Checkpoint legacy VERIFY menggunakan proposal pending tanpa panggilan VERIFY.
- Progres 4/9 → 6/9 → retry/reload tidak turun, konflik manual/concurrency tidak menimpa sumber terbaru, serta undo/backup tetap berlaku.
- Excel asli 9 Bab/23 materi dan proyek augmented 9 Bab/27 materi tetap dibaca. Keputusan pemetaan AI pada tes adalah mock; bukti bukan hasil Gemini live.
- Step 08, meeting alignment dan modul ajar tetap menerima relasi/lingkup kanonikal; aktivitas tidak dibuat pada Step 07.

Hasil final:

| Pemeriksaan | Hasil |
| --- | --- |
| Seluruh 33 suite Step 07–08/mapping + meeting alignment + Audit No8 learning-plan | PASS, satu putaran bersih |
| Single-analysis auto-repair | PASS 10 skenario, termasuk request/input/output budget |
| Checkpoint/resume/legacy/corrupt/GLOBAL coverage | PASS 9 skenario pada kode final |
| Isolasi target Bab, edit manual, lock dan undo | PASS 12 skenario |
| Progres 4→6→retry/reload, UI sync, timeout dan konflik sumber | PASS 7 skenario |
| Teknik dasar meluncur → dua TP, satu panggilan tanpa proof/rename | PASS, keputusan AI mock |
| Lint + typecheck (`npm run lint` menjalankan `tsc --noEmit`) | PASS |
| Build frontend/server (`npm run build`) | PASS; peringatan bundle frontend >500 kB |
| `git diff --check` | PASS |
| Gemini live / browser deployment | BELUM DIUJI |

Putaran awal mengidentifikasi ekspektasi lama yang tidak lagi berlaku (wajib VERIFY, kutipan, sertifikat, dan menolak mapping valid tanpa proof); ekspektasi tersebut diganti dengan kontrak struktural dan negatif ID/lineage/stale. Regresi rendering menemukan referensi variabel approval lama yang tersisa; sudah diperbaiki dan seluruh suite direrun. Log sementara berada di `tmp/` yang diabaikan Git. Pengujian checkpoint GLOBAL tambahan dijalankan ulang setelah memperbaiki filter cakupan global, dengan source fingerprint fixture yang diakui cocok terhadap sumber kanonikal tes.

## Risiko tersisa

Validasi struktural tidak membuktikan mutu pedagogis pemilihan TP oleh model. Relevansi menjadi tanggung jawab analisis AI satu respons dan koreksi guru yang tersedia melalui editor/histori; tidak ada verifikasi model kedua. Kuota/akses Gemini live dan browser deployment belum diuji. Checkpoint legacy yang tidak memiliki proposal struktural valid dapat membutuhkan analisis gap baru, tanpa membatalkan progres tersimpan. Tidak ada push/deploy pada tugas ini.
