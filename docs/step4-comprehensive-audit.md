# Finalisasi menyeluruh Step 4 — Analisis CP

Tanggal audit: 30 Oktober 2026. Baseline main: `66e5390d480678030cebce4b82537ffb839b9a55`.
Branch tunggal: `codex/step4-comprehensive-hardening`. Tidak membuat PR tambahan atau merge.

## Akar masalah

1. Client membaca JSON tanpa memeriksa Content-Type. HTML dari proxy/runtime, JSON terpotong, bentuk payload salah dan error HTTP dapat terlihat sebagai RESPONSE_INVALID generik. Parser provider juga kehilangan alasan dan metadata percobaan saat parsing gagal.
2. Input elemen belum divalidasi menyeluruh sebelum request. Validasi respons belum memiliki konteks field/row yang cukup untuk memperbaiki selain kolom 3.
3. Coverage lama bersifat global dan bisa membuang hasil elemen lain yang valid. Tidak ada rencana retry untuk klausa/kompetensi yang belum tercakup; reanalysis dan repair tidak dibedakan pada tindakan UI.
4. Tarik struktur CP langsung mengganti daftar, menyimpan, serta mereset provenance/review timestamp. Ini berisiko merusak referensi baris dan data guru.

## Tahapan implementasi dan pengujian

P0, P1, P2, P3 diuji berurutan sebelum tahap berikutnya, lalu diulang sebagai suite akhir.

- **P0 PASS:** status HTTP diprioritaskan; Content-Type JSON/+json diperiksa; HTML (termasuk yang salah diberi header JSON), respons kosong, JSON terpotong, syntax JSON, ukuran berlebih, engine/output contract dibedakan. Error tetap membawa request ID/trace dan alasan aman `source/reason/httpStatus/mime`. Tidak menampilkan body/header/key/error provider mentah. JSON terpotong tidak diperbaiki dengan tebakan.
- **P1 PASS:** preflight elemen CP; ID kanonikal unik dan nama/teks wajib; beberapa butir per elemen; cakupan per klausa dan kata kerja kompetensi yang dikenali; error teknis, struktur dan kualitas terpisah. Pemeriksa semantik existing dipakai untuk kompetensi, materi dan usulan TP, tanpa mengubah implementasinya. Hasil valid dipertahankan dan repair hanya meminta field/baris/klausa/elemen bermasalah.
- **P2 PASS:** full reanalysis memakai ID baris existing sebagai target; nilai terisi menjadi usulan terpisah yang membutuhkan checkbox persetujuan per kolom. Kolom kosong dilengkapi hanya dalam proposal. Pratinjau → terapkan ke draft → Simpan Analisis eksplisit. Apply tanpa perubahan tidak menandai provenance/dirty state. Tarik struktur meminta konfirmasi bila analisis berisi data, hanya menambah elemen yang belum ada, tidak menimpa atau menyimpan. Context/profile/CP change dan unmount membatalkan request serta menutup konfirmasi lama. Tidak ada auto rebase/clear needsReview.
- **P3 PASS:** tindakan Analisis Ulang Seluruh CP versus Perbaiki Hasil Bermasalah dibedakan; status per elemen Siap/Perlu ditinjau/Gagal dan Memproses hanya untuk target aktif; retry per elemen. Status mutu ini bukan perubahan status/gate workflow. Salin Diagnosis mempertahankan informasi deadline, kategori masalah, alasan parsing dan ID teknis (termasuk timestamp ID), dengan redaksi key/kontak dan fallback clipboard existing.

Kebijakan 80 detik client / maksimum 75 detik server / 35 detik per percobaan / maksimum dua percobaan hanya untuk 429/503 tetap dipertahankan. Model primary existing tidak diganti. Tidak ada retry berantai atau pemilihan key berulang.

`repairTargets` hanya kontrak request AI Step 4. Tidak ada field baru pada CPAnalysisData/CPAnalysisItem atau storage. Legacy retryTargets kolom 3 tetap didukung.

## Bukti kompatibilitas Step 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

`testStep4DownstreamCompatibility.ts` memuat modul baseline langsung dari worktree main dan modul branch dalam dua proses terpisah. Fixture existing `createTwoSemesterAdministrationImportFixture()` dipakai utuh, tanpa meregenerasi CP/TP/ATP atau mengubah produsen downstream agar tes lolos.

- Callback AI Step 4 aktual dijalankan pada proyek existing dengan provider simulasi; tidak ada perubahan editor/storage tanpa penerapan/simpan eksplisit.
- Data CP, analisis, TP, ATP, pemetaan, rencana pelaksanaan, profil dan kedua semester, gate/stale report, proyeksi ATP/PROTA/PROMES/modul ajar identik sebelum/sesudah untuk input analisis yang sama.
- CP/analisis/TP/ATP pada fixture lolos validator SIAP pada main dan branch. Kesiapan pemetaan juga sama.
- **215 fingerprint implementasi/fixture terlindungi identik:** termasuk Step 3, App, seluruh implementasi Step 5–10, dokumen, data CP, public types dan storage. Seluruh fungsi AI bersama selain analyzeCPWithAI identik.
- Handler Simpan Analisis, ekspresi gate Step 4, isCPOutdated/needsReview dan validator lokal kolom 3 identik dengan main; validator workflow bersama tidak disentuh.
- Save/reload serta ZIP RESTORE mempertahankan ID dan relasi annual data secara tepat. Ekspor boleh menulis diagnosis ekspor existing; tidak ada penulisan key storage proyek.
- **14 DOCX + 16 PDF:** seluruh hash teks ekspor aktual identik dengan main. Teks DOCX diekstrak dari word/document.xml; teks PDF direkam dari pemanggilan text renderer aktual. Tidak membandingkan metadata ZIP/PDF acak sebagai substansi.
- **Dua DOCX pemetaan tetap BLOCKED pada main dan branch:** fixture tidak memiliki Unit/Bab pada butir ATP yang dipersyaratkan generator DOCX. Data pemetaan dan PDF pemetaan tetap identik. Tidak mengisi field legacy atau mengubah generator untuk melewati blocker.

Pengujian tersebut membuktikan kompatibilitas input yang sama; analisis baru yang sengaja diubah dan disimpan tetap mengikuti invalidasi/lineage/gate downstream existing. Butir baru tidak otomatis ditautkan ke TP lama.

## Hasil tes

| Pemeriksaan | Main | Branch | Keterangan |
| --- | --- | --- | --- |
| P0–P3 hardening (tes baru) | — | PASS | Response/input/coverage/quality/full & partial retry/consent/cancel/profile/render/status/diagnosis |
| Step4 deadline | PASS sebelum perubahan | PASS | SDK HTTP simulasi, HTTP lokal, sukses/lambat/429/503/timeout/abort/replay/late response/storage |
| Step4 meaningful understanding | PASS sebelum perubahan | PASS | Fixture disesuaikan ke strict Content-Type dan callback baru; perlindungan lama tetap diuji |
| CP Analysis Integrity | PASS sebelum perubahan | PASS 33/33 | Assertion CP yang mengharapkan autosave/rebase struktur disesuaikan; gate tetap diuji |
| CP semantic review / annual CP / CP analysis runtime | — | PASS | Tidak ada perubahan implementasi downstream |
| Snapshot fixture Step 3–10 | PASS | PASS identik | Termasuk 30 hasil ekspor dan dua blocker sama |
| Step4 Final Check / Step7–8 lineage / ATP document projection | PASS | PASS | — |
| Modul ajar meeting projection / Annual ZIP / Complete archive / Storage persistence | PASS | PASS | — |
| Canonical Merdeka Workflow | FAIL | FAIL sama | ATP_SEMANTIC_FIDELITY: fokus ATP fixture belum membuktikan kompetensi understand |
| Canonical PROTA projection | FAIL | FAIL sama | Case 1, readiness projection |
| Canonical PROMES projection | FAIL | FAIL sama | Case 1–3, readiness projection |
| Workflow dependency | FAIL | FAIL sama | Missing CP analysis seharusnya memblokir TP; ekspektasi lama gagal sama, implementasi tidak diubah |
| TypeScript penuh | FAIL 68 | FAIL 68 identik | Tidak menambah diagnostik |
| Build produksi | — | PASS | Warning ukuran chunk existing |

Tidak mengubah tes CI navigasi/kalender/ATP atau memperbaiki kegagalan baseline di luar Step 4. Tidak menyatakan seluruh CI hijau.

## Reproduksi perbandingan baseline

1. Buat checkout main pada SHA basis di atas dengan dependensi yang sama.
2. Dari workspace branch, set CP4_BASE_ROOT ke path checkout main dan CP4_SNAPSHOT_OUT ke file JSON sementara; jalankan `npm run test:step4-downstream`.
3. Hapus CP4_BASE_ROOT, set CP4_SNAPSHOT_BASELINE ke file tersebut, lalu jalankan perintah yang sama. Snapshot/proyek seluruhnya fixture sintetis, bukan data guru nyata.
4. `npm run test:step4-hardening`, `npm run test:step4-deadline`, `npm run test:step4-understanding`, serta tes regresi pada tabel dapat dijalankan terpisah.

## Batas dan risiko tersisa

- Gemini nyata belum dijalankan: GEMINI_API_KEY tidak tersedia pada environment/.env yang diperiksa. Tidak membaca key browser guru. SDK/HTTP provider menggunakan simulasi; HTTP lokal bukan deployment production proof.
- Runtime Express lokal masih terblokir MODULE_NOT_FOUND debug, sama dengan audit baseline. Tidak mengubah dependency/lockfile.
- Pemeriksaan kualitas bersifat konservatif dan dapat menandai parafrase yang sah untuk review; bukan sertifikasi pedagogis otomatis. Pemeriksaan visual browser/DOCX/PDF belum dilakukan; SSR dan substansi ekspor sudah diuji.
- CP sumber yang berubah tetap mengikuti needsReview/stale gate main. Tidak otomatis membersihkan flag, merebase timestamp atau menyembunyikan lineage yang belum cocok. Perubahan kontrak lintas-step untuk perilaku lain tidak diimplementasikan.
- Abort HTTP tidak menjamin inference Google yang sudah diterima berhenti; percobaan lokal dihentikan dan respons terlambat dibuang, tanpa retry otomatis setelah timeout.

## File berubah

- src/components/CPAnalysisManager.tsx
- src/services/aiService.ts (hanya analyzeCPWithAI dan import Step 4)
- src/services/cpAnalysisAIContract.ts
- src/services/cpAnalysisAIDiagnostics.ts
- src/services/cpAnalysisDraft.ts (baru)
- src/services/cpAnalysisResponse.ts (baru)
- server/cpAnalysisAI.ts
- server/cpAnalysisDeadline.ts
- scripts/testStep4HardeningRegression.ts (baru)
- scripts/testStep4DownstreamCompatibility.ts (baru)
- scripts/testStep4DeadlineRegression.ts
- scripts/testStep4MeaningfulUnderstandingRegression.ts
- scripts/testMerdekaCPAnalysisIntegrity.ts (hanya assertion terkait Step 4)
- package.json (perintah tes)
- docs/step4-comprehensive-audit.md (laporan ini)
