# Audit AI Step 4 — meaningfulUnderstanding

Basis: main `bf52c01074deadd43205a384c94cd322e4cd590d` (di-fetch sebelum perubahan). Branch kerja: `codex/step4-meaningful-understanding`. Tidak ada merge.

## Akar masalah

1. Prompt hanya menyebut kolom 3 secara singkat sebagai pemahaman/variasi keterampilan. Schema Gemini tidak mewajibkan meaningfulUnderstanding maupun elementId.
2. Sanitizer server hanya mewajibkan cpCompetence/materialScope. meaningfulUnderstanding hilang dinormalisasi menjadi string kosong dan masih dapat dinyatakan sukses.
3. Ketika respons tidak lolos atau provider gagal, endpoint menggunakan fallback lokal yang sengaja mengosongkan kolom 3. Penyebab provider/validasi tertutup oleh respons sukses fallback.
4. Client tidak memvalidasi payload per elemen. Workflow bersama tidak memeriksa kolom 3, sehingga UI tidak memberi diagnosis spesifik.
5. executeAIAnalysis membuat ID baris baru, mengganti seluruh daftar dan langsung memanggil onSaveCPAnalysis, termasuk ketika kolom 3 belum lengkap; needsReview serta lineage timestamp dapat di-reset.

## Perbaikan

- Endpoint CP memakai handler terfokus yang dapat diuji langsung. Prompt/schema mewajibkan kolom 3 dan ID elemen. Retry hanya mengeluarkan itemId, elementId, meaningfulUnderstanding untuk target yang diminta.
- Validasi server dan client memeriksa bentuk, referensi kanonikal, elemen yang hilang, ID target ganda, tipe/isi kolom serta keterlacakan istilah kolom 3 ke CP. Istilah isi di luar CP ditandai MU_GROUNDING_REVIEW; bukan diisi dengan kalimat sintetis. Salinan verbatim CP bukan pemahaman bermakna yang valid.
- Guard cakupan klausa CP tetap digunakan. Kegagalan cakupan/identitas pada analisis awal tidak dapat menjadi draft siap.
- Error provider tidak lagi disamarkan sebagai fallback sukses. Fallback tanpa key tetap tersedia sebagai draft lokal dengan diagnosis kolom kosong. Retry AI tanpa konfigurasi memberi AI_NOT_CONFIGURED. Tidak mengganti konfigurasi/model provider existing.
- analyzeCPWithAI membatasi waktu 90 detik, memvalidasi JSON dan payload, serta membatasi kode/pesan error yang diteruskan. Parser khusus CP tidak mencatat respons mentah ke log.
- Hasil AI dipratinjau, diterapkan ke draft secara eksplisit, kemudian disimpan melalui tombol Simpan Analisis existing. Eksekusi AI/retry tidak menulis storage.
- Pada analisis existing, AI hanya mengusulkan kolom 3 bermasalah. Patch hanya mengisi kolom 3 kosong dengan pasangan ID baris–elemen dan nilai sebelumnya yang masih cocok. Kolom 1/2/4, baris lain, ID, relasi, ringkasan manual dan nilai manual nonkosong dipertahankan. Usulan bagi nilai nonkosong dapat dibaca untuk edit manual, tidak diterapkan otomatis.
- Hasil dibatalkan bila context/CP/draft berubah saat permintaan berlangsung atau sebelum penerapan. Penyimpanan eksplisit mempertahankan metadata existing dan tidak otomatis menghapus needsReview/timestamp lineage lama.
- Validasi tambahan di UI Step 4 menandai kolom 3 kosong/placeholder saat simpan dan menahan lanjut, tanpa mengubah validator workflow bersama atau mewajibkan diksi AI pada prosa manual lama.
- Salin Diagnosis tersedia pada area error: waktu, build ID/SHA, step, mapel kanonikal, fase, kelas, kode, tahap, jumlah/ID elemen, pesan aman dan ringkasan per field. Tidak menyertakan key, token, identitas guru/sekolah, respons provider atau teks CP. Fallback: Clipboard API → textarea sementara + copy → textarea terlihat untuk salin manual.

## Hasil pengujian

| Pemeriksaan | Hasil |
| --- | --- |
| testStep4MeaningfulUnderstandingRegression | PASS: lengkap, kosong, malformed, partial, grounding, retry, duplikat/ID asing, API/network/timeout, perlindungan manual, stale context/edit, apply/save eksplisit, metadata, persisted CP/analysis/TP/ATP/profil/semester + reload, copy/fallback/privacy |
| testMerdekaCPAnalysisIntegrity | PASS 33/33; hanya assertion CP yang kontraknya berubah diperbarui |
| testCPAnalysisSemanticReviewRegression | PASS |
| testMerdekaV5CPAnalysisRuntime / AnnualCPRuntime | PASS / PASS |
| testCP046ReviewIntegration / SafetyRegression | PASS / PASS |
| testCompleteProjectArchiveRegression / StorageV5Persistence | PASS / PASS |
| TypeScript seluruh repo | FAIL: 68 diagnostik identik dengan checkout main bf52c01; tidak ada tambahan |
| Build produksi | PASS; peringatan ukuran chunk existing |
| testCP046CompatibilityRegression | FAIL baseline: loader baseline menambahkan .ts pada file JSON setelah integrasi CP masuk main. Direproduksi di main bf52c01; tes tidak diubah karena bukan scope Step 4 |
| HTTP smoke produksi opsional (--http) | BLOCKED lingkungan: server berhenti saat require Express karena node_modules/finalhandler/node_modules/debug/src/index.js hilang. require Express pada checkout main gagal sama. Tidak memperbaiki dependency atau lockfile |

Handler endpoint diuji dengan provider simulasi dan client diuji melalui fetch simulasi; bukan bukti Gemini live. Pemeriksaan istilah bersifat konservatif, sehingga parafrase sah bisa memerlukan review. Tidak mengklaim validasi semantik otomatis sempurna atau pengujian visual browser/clipboard nyata.

## Batas perubahan

Tidak mengubah App, CP kanonikal, validator workflow bersama, TP, ATP, PROTA, PROMES, modul ajar, storage/schema, data proyek nyata, dependensi atau tes CI non-CP. Tidak ada migrasi.

File dalam perubahan ini:

- package.json (perintah tes Step 4)
- server.ts (delegasi endpoint CP)
- server/cpAnalysisAI.ts (prompt, parser aman dan handler CP)
- src/services/cpAnalysisAIContract.ts (validasi per elemen dan patch aman)
- src/services/cpAnalysisAIDiagnostics.ts (diagnosis aman dan salin/fallback)
- src/services/aiService.ts (client analyzeCPWithAI saja)
- src/components/CPAnalysisManager.tsx (draft, retry, validasi UI dan diagnosis)
- scripts/testStep4MeaningfulUnderstandingRegression.ts (tes perilaku baru)
- scripts/testMerdekaCPAnalysisIntegrity.ts (assertion CP terkait kontrak baru)
- docs/step4-meaningful-understanding-audit.md (laporan ini)
