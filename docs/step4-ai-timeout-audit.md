# AI Step 4: audit dan perbaikan deadline total

Basis perubahan: `f4a61e63022b78ac77bdd159580437aa926fde55`, branch tetap `codex/step4-meaningful-understanding`. Tidak membuat branch/PR atau merge.

## Akar masalah yang terbukti dari kode

- analyzeCPWithAI sebelumnya memutus penantian setelah 90 detik, tetapi endpoint memakai generateContentWithRetry yang dapat mencoba 3 model × 2 percobaan tanpa deadline total atau timeout per panggilan Gemini.
- Abort client tidak diteruskan ke siklus provider. Server dapat terus menunggu/mencoba setelah browser berhenti.
- aiFetch bersama dapat mengirim request tambahan saat pemilihan key (fallback lokal → BYOK atau AI_NOT_CONFIGURED → key lokal). Siklus tersebut memakai batas client yang sama, tanpa koordinasi deadline provider.
- Guard isAnalyzing berbasis state React saja tidak mengunci dua klik dalam render yang sama. Guard versi menolak respons stale, tetapi belum membatalkan transport pada pergantian context/unmount.
- AI_TIMEOUT lama tidak membawa request ID, model/percobaan/durasi atau sumber timeout; dua kejadian transport tersebut tidak cukup membuktikan kegagalan model tertentu.

Tidak mengklaim telah mengetahui latency atau status Gemini pada dua permintaan historis tanpa telemetry provider. Model tidak diganti berdasarkan asumsi.

## Kontrak deadline baru, khusus Step 4

| Batas | Nilai |
| --- | --- |
| Operasi client, termasuk fetch/body/validasi | 80.000 ms maksimum |
| Kerja server | 75.000 ms maksimum, juga dibatasi deadline absolut client dikurangi cadangan 5.000 ms |
| Setiap percobaan provider | min(35.000 ms, sisa deadline server) |
| Jumlah percobaan | Maksimum 2, hanya satu model |
| Retry | Hanya HTTP 429/503 yang terkonfirmasi, jeda 400 ms dalam anggaran yang sama |

Model tetap primary existing `gemini-3.8-flash`. Tidak mengganti model/key setelah error. 400/401/403/404 serta error lain tidak memicu tebakan model alternatif. Retry SDK diset eksplisit attempts: 1 agar hanya scheduler Step 4 yang menghitung percobaan. Generator/shared retry untuk TP/ATP dan endpoint lain tidak diubah.

Timeout percobaan bersifat terminal, bukan alasan mencoba model/key baru. Deadline diperiksa sebelum memulai percobaan dan sesudah menerima respons; timer, signal SDK dan deadline total menghentikan penantian lokal. SDK @google/genai 2.28.0 yang terpasang mendukung abortSignal, httpOptions.timeout dan retryOptions.attempts. Dokumentasi tipe SDK secara eksplisit menyatakan abort HTTP tidak menjamin inference Google yang sudah diterima ikut dibatalkan. Karena itu tidak ada automatic retry sesudah timeout dan hasil terlambat dibuang.

## Key, duplicate, UI dan keamanan data

- Client Step 4 memilih key sekali: BYOK lokal jika ada, selain itu key server bila dikonfigurasi. Tidak memakai rantai retry/modal/key-removal aiFetch bersama. Endpoint tetap mengikuti resolusi header request lalu environment server; key yang telah dipilih dipakai konsisten pada kedua percobaan yang diizinkan.
- Satu fetch per tindakan AI. Guard ref sinkron menahan klik ganda, guard request ID menahan duplikasi transport, dan lease request ID di server menolak replay pada key yang sama. Lease hanya menyimpan hash scoped key/request ID dengan TTL dan batas ukuran, tanpa teks CP atau key mentah. Lease berlaku per proses server, bukan kunci lintas deployment.
- Abort pada tombol Batalkan Analisis AI, pergantian context/CP dan unmount diteruskan ke fetch; disconnect client diteruskan ke server/provider. Callback terlambat dan finally request lama tidak dapat mengganti proposal atau busy flag request baru.
- Timeout mempertahankan editor, nilai manual, hasil AI sebelumnya yang belum diterapkan, analisis tersimpan, ID/relasi dan data proyek lain. Tidak ada onSaveCPAnalysis saat menjalankan AI, retry, timeout atau abort.
- Retry kolom 3 tetap memakai pasangan itemId/elementId dengan patch kosong saja dan penerapan eksplisit. Analisis penuh memakai jalur deadline yang sama. Validator/prompt substantif dan perlindungan hasil Step 4 sebelumnya dipertahankan.

## Salin Diagnosis

Ditambah request ID, durasi end-to-end, sumber timeout (client/server/provider), sumber key dalam bentuk label, model/percobaan yang sudah dilaporkan server, durasi/outcome/HTTP status per percobaan, dan tahap terakhir. Jika metadata server belum diterima, model/percobaan tidak ditebak. Nilai disaring melalui daftar field/kode/model yang diizinkan. Tidak menyalin API key, header, token, error provider mentah, identitas guru/sekolah atau CP lengkap. Fallback clipboard sebelumnya tetap dipakai.

## Pengujian dan batas pembuktian

| Pemeriksaan | Hasil |
| --- | --- |
| testStep4DeadlineRegression | PASS simulasi: kasus B. Indonesia Fase A Kelas 2, 4 elemen; sukses/lambat; 429/503; fatal 400/401/403/404; deadline client/server/provider; abort generation/backoff/transport; duplicate/replay; late response; diagnosis/copy; storage/reload |
| Callback server aktual + SDK Gemini terpasang, HTTP SDK tiruan | PASS: primary sama, 429 lalu sukses tepat 2 percobaan scheduler, tidak dikalikan retry SDK; tidak menghubungi Google |
| HTTP lokal nyata dengan coordinator produksi + provider simulasi | PASS: analisis lengkap, retry kolom 3, korelasi request ID, deadline server round trip |
| Callback UI aktual dan penyimpanan | PASS: klik ganda, context stale, abort/late, finally lama, semua sumber timeout; CP/analysis/TP/ATP/profil/semester utuh dan tidak ditulis |
| testStep4MeaningfulUnderstandingRegression | PASS: validasi, manual protection, explicit apply/save, clipboard fallback/privacy |
| testMerdekaCPAnalysisIntegrity | PASS 33/33; file tes CI lama tidak diubah |
| CP semantic review / CP analysis runtime / annual CP runtime | PASS / PASS / PASS |
| Storage persistence / complete project archive | PASS / PASS |
| Build produksi | PASS; warning ukuran chunk existing |
| TypeScript | FAIL baseline: 68 diagnostik identik dengan main yang diaudit; tidak ada diagnostik tambahan |
| Runtime Express produksi | BLOCKED baseline lokal: require Express masih gagal MODULE_NOT_FOUND (debug); dependency tidak diperbaiki dalam scope ini |
| Gemini nyata | TIDAK DIJALANKAN: GEMINI_API_KEY tidak tersedia pada environment/.env yang diperiksa. Key browser guru tidak dibaca. Tidak mengklaim sukses provider live |

Build dan HTTP adapter test tidak sama dengan bukti Express produksi/deployment, clipboard browser nyata, atau Gemini live. Deadline dan hasil simulasi membuktikan batas penantian/retry dan perlindungan data, bukan jaminan latency Google.

## File berubah

- package.json: perintah tes deadline Step 4
- src/services/cpAnalysisRun.ts: kontrak budget/request ID/trace aman
- server/cpAnalysisDeadline.ts: scheduler provider dan coordinator endpoint
- server.ts: hanya wiring endpoint analyze-cp ke scheduler khusus
- server/cpAnalysisAI.ts: opsi meneruskan error provider ke coordinator deadline
- src/services/aiService.ts: hanya jalur analyzeCPWithAI
- src/services/cpAnalysisAIDiagnostics.ts: telemetry aman untuk Salin Diagnosis
- src/components/CPAnalysisManager.tsx: single-flight, cancel dan guard hasil terlambat
- scripts/testStep4DeadlineRegression.ts: tes deadline baru
- scripts/testStep4MeaningfulUnderstandingRegression.ts: fixture callback ref baru, tanpa perubahan ekspektasi lama
- docs/step4-ai-timeout-audit.md: laporan ini

Tidak mengubah CP kanonikal, TP/ATP, dokumen, storage/schema, dependensi, konfigurasi model bersama, atau tes CI lama. Tidak memakai data guru nyata.
