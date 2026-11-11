# Step 07 — koreksi batas tanggung jawab pemetaan

Baseline: `ce7bb0d6140f99333a55a514354d30c9cc638327`, main. Tidak ada pengujian Gemini live dalam audit ini.

## Bukti akar masalah per jalur

| File / fungsi | Masalah dan koreksi |
| --- | --- |
| `server/mappingAnalysis.ts` / `buildMappingAnalysisPrompt`, `buildStep07AutoInstructions` | Prompt meminta aktivitas konkret, mendorong rename agar kompetensi eksplisit, termasuk setelah mismatch. Diubah menjadi penilaian substansi, kompetensi, cakupan dan lineage dalam konteks Bab, materi, mapel dan TP/ATP kanonikal. Judul singkat dipertahankan; tidak menyusun aktivitas. Verifier tetap independen dari pengusul. |
| `server.ts` / generator canonical mapping | Petunjuk integrasi transversal merujuk kegiatan. Diperjelas menjadi relevansi substansi/cakupan dan larangan menyusun aktivitas di tahap pemetaan. Tidak mengubah prompt modul ajar. |
| `step07AutoExecutionPolicy.ts` / validasi aksi dan stored semantic proof | EDIT/MOVE/ADD mewajibkan kutipan kompetensi muncul literal pada hasil. Kini kutipan harus sah terhadap sumber dan putusan independen SUPPORTED harus memiliki penjelasan relevansi per TP untuk judul implisit. Aturan ini juga digunakan setelah reload. Bukti lama berformat literal yang sebelumnya sah tetap diterima tanpa migrasi; token tidak menggantikan putusan independen. Semua bukti sekunder tetap diperiksa. |
| `mappingAlignmentService.ts` / `applyMinimalAlignment` | Content change yang sudah mendapat otoritas guru/verifier masih ditolak karena `.supported` leksikal. Veto leksikal dihapus; validitas sumber, otoritas, konflik nyata dan lineage tetap berlaku. Edit substantif manual yang membuang konteks sumber tetap ditolak untuk ditinjau. |
| `server/mappingSemanticEvidence.ts` | Ketiadaan token semula menghasilkan ambiguous=false dan pesan tidak ada bukti. Kini dinyatakan belum dapat diputuskan dari judul saja. Sinyal `.supported` dinyatakan leksikal, bukan otorisasi semantik. Pemeriksaan konflik eksplisit dipertahankan. |
| `atpUnitMappingValidationService.ts` | Konteks Bab disertakan pada pemeriksaan materi; pemeriksaan subset, coverage, referensi, konflik dan pasangan TP–ATP tetap sama. |
| `AlignmentProposalReview.tsx`, `ATPUnitMappingManager.tsx`, `buildMappingMaterialResolutions`, `server/mappingBabFirstAnalysis.ts` | Bahasa tinjauan diganti dari bukti aktivitas menjadi alasan relevansi substansi/kompetensi/cakupan. Usulan alasan AI dapat diisi sebagai draft yang harus diperiksa dan disetujui guru. Tidak ada kegiatan baru yang disimpan. |
| `step07CheckpointService.ts`, `step07HybridRepairService.ts` | Keputusan tertunda dari kebijakan lama bisa terus menolak judul dan mencapai stagnasi meskipun kebijakan berubah. Ditambahkan versi kebijakan opsional per checkpoint Bab. Pada Bab bermasalah, cache keputusan AI tertunda versi lama dan guard percobaannya dinilai ulang satu kali. Keputusan lama diarsipkan melalui mekanisme invalidated existing yang dibatasi ukurannya, sehingga alasan aktivitas lama tidak dikirim sebagai arahan aktif. Bukti yang sudah diterapkan, histori perubahan, mapping V5 dan Bab selesai tidak dihapus. Tidak ada migrasi proyek atau perubahan schemaVersion. |

## Otoritas dan kesiapan tetap sama

PROPOSE tidak memberi izin apply. VERIFY tetap memerlukan SUPPORTED, alasan independen, kutipan sumber valid untuk setiap TP, konteks sumber terjaga dan tidak ada missingEvidence. CONFLICT, NEEDS_REVIEW, bukti tidak lengkap dan sumber palsu tetap ditolak. ATP diturunkan dari TP kanonikal; tidak ada ID baru, lineage fiktif atau set canProceed manual.

Tinjauan guru tetap dicatat melalui action engine, histori dan mekanisme save existing. `finalizeTeacherReviewedMapping` dan `resolveATPUnitMappingReadiness` tidak diubah: bukti relevansi yang sah dan validator lengkap tetap menjadi pengunci Step 08. Proteksi lock, CAS, timeout, late response, scope Bab, serta undo tetap digunakan.

## Konsumsi downstream

`createEmptyUnitExecutionPlanData` dan `validateUnitExecutionPlan` memakai Bab serta ID materi/TP/ATP dari mapping. `buildLearningPlanScopeUnits` membawa judul, materialScope, materials, TP/ATP dan pertemuan canonical ke modul ajar. `createEmptyLearningPlan` tidak mengarang aktivitas. `/api/ai/generate-learning-plan` di `server.ts` merumuskan learningSteps/learningExperiences sesuai scope pertemuan dan anggaran. Jalur downstream ini tidak diubah.

## Verifikasi

`testStep07MappingScope.tsx` menggunakan fixture proyek PJOK 9 Bab/27 materi, storage V5/checkpoint/validator/action engine sebenarnya, serta verifier dan keputusan guru simulasi. Kasus utama:

- Teknik dasar meluncur → E1-SKG-01/02 diterima dengan alasan relevansi substansi, tanpa aktivitas konkret atau rename.
- EDIT relevan juga tidak wajib memakai kata kerja TP; konteks dan otoritas tetap diperlukan.
- Putusan negatif/ambigu, missing evidence, kutipan palsu dan alasan per-TP kosong ditolak.
- Checkpoint kebijakan lama yang stagnan dapat dinilai ulang; hasil valid tersimpan/reload dan readiness Step 08 konsisten.
- Seluruh judul, sumber kanonikal dan Bab lain tetap sama; TP–ATP mismatch ditolak.
- Step 08 dapat menyiapkan struktur dari mapping, modul menerima tujuan kanonikal tanpa aktivitas yang dibuat Step 07.
- Prompt dan UI meminta relevansi pemetaan; sinyal token tidak menyatakan hubungan implisit tidak relevan.

Hasil tes final:

| Skenario / suite | Hasil |
| --- | --- |
| Meluncur ↔ E1-SKG-01/02, tanpa aktivitas konkret/rename | PASS, verifier mock |
| Relasi tidak relevan, putusan negatif/ambigu, bukti palsu/tidak lengkap | PASS, checker deterministik + verifier mock |
| TP–ATP mismatch | PASS, validator sebenarnya |
| Per-Bab tidak mengubah Bab lain | PASS; suite target-unit 12 skenario |
| ACC, save/reload V5, checkpoint, readiness | PASS; guidance 4 skenario, hybrid checkpoint 20 skenario, dan skenario baru |
| Konsumsi Step 08 dan batas aktivitas modul ajar | PASS; scope test + JP integration, meeting alignment, Audit No8 learning-plan |
| 30 suite Step 07/pemetaan + 3 suite downstream | PASS setelah rerun kasus yang diperbaiki |
| Lint dan typecheck (`npm run lint` = `tsc --noEmit`) | PASS |
| Build frontend/server (`npm run build`) | PASS; peringatan ukuran bundle >500 kB |
| `git diff --check` | PASS |
| Gemini live dan browser deployment | BELUM DIUJI |

Batch awal berisi 29 suite existing; dua kasus sempat gagal. Auto-repair masih mengharapkan EDIT wajib memuat kompetensi literal: ekspektasi dikoreksi dengan pasangan uji positif/negatif alasan relevansi. Minimal-alignment menemukan proteksi perubahan topik total perlu tetap ada: guard konteks sumber dipertahankan, tanpa veto kesamaan kata TP. Keduanya lulus setelah rerun. Suite checkpoint dan guidance dijalankan ulang setelah perubahan kebijakan/cache; suite mapping-scope baru dijalankan pada kode final. Log berada di `tmp/` yang diabaikan Git.

## Risiko dan batas pembuktian

Tidak ada panggilan Gemini live atau pengujian browser deployment. Verifier simulasi membuktikan kontrak penerimaan/penolakan, bukan akurasi pedagogis model live. Pemeriksaan deterministik mengenali konflik eksplisit terbatas; relevansi implisit tetap memerlukan verifier independen atau tinjauan guru. Cache AI tertunda dari kriteria lama membutuhkan penilaian ulang satu kali, dengan guard biaya/timeout yang sama. Judul hasil edit terdahulu tidak dirollback otomatis karena dapat memuat keputusan manual; histori dan undo tetap tersedia dengan proteksinya.
