# Step 07 — Analisis ulang per Bab

Baseline: `0f786122482d94461cd009dba7fdd25d86408769`, branch `main`.

## Audit dan batas perubahan

`runStep07AutoRepair` sudah meneruskan `activeUnitId` ke permintaan semantik, tetapi `runHybridStep07Repair` tetap membangun antrean seluruh Bab lalu rekonsiliasi GLOBAL. UI hanya memiliki pemicu analisis seluruh pemetaan. Karena itu pembatasan request AI saja belum menyediakan analisis ulang satu Bab yang aman.

Penyimpanan V5, checkpoint, lock profil, timeout/retry, validasi semantik independen, validator readiness, serta engine apply tetap digunakan. Tidak ada perubahan prompt, TP/ATP kanonikal, aturan semantik, atau penyimpanan baru.

## Perubahan

- `step07AutoRepairService.ts`: opsi `targetUnitId`, filter aksi lintas-Bab, metadata target opsional, dan undo terbatas pada Bab terpilih. Jalur tanpa target tetap menggunakan perilaku lama.
- `step07HybridRepairService.ts`: hanya mengeksekusi target, melewati AI GLOBAL, menilai ulang readiness global, dan memeriksa isolasi sebelum checkpoint/apply-save. Bab valid menjadi no-op. Buffer checkpoint Bab lain dipertahankan. Snapshot V5 menjadi dasar penyimpanan; edit Bab lain yang belum disimpan dikembalikan ke draft tanpa ikut disimpan. Kegagalan AI tidak menyimpan edit target yang belum diverifikasi, termasuk jalur penanda proses legacy. Buffer terverifikasi dengan perubahan bukti/histori saja tetap dapat dipulihkan dan disimpan.
- `ATPUnitMappingManager.tsx`: tombol di setiap header Bab, status lokal/loading/jumlah masalah tersisa, synchronous busy guard, serta penanganan error. Tombol global/resume tetap memakai handler yang sama tanpa target.
- `types/index.ts`: `Step07AutoRepairRun.targetUnitId` opsional; data lama tetap kompatibel tanpa migrasi.
- `scripts/testStep07TargetUnit.ts`: regresi terarah dengan fixture proyek PJOK asli, persistence/backup/checkpoint/readiness sebenarnya, provider AI dan Web Locks simulasi, SSR komponen dan handler UI aktual.
- `package.json`, `scripts/ci/test-groups.json`: pendaftaran tes baru; dua tes UI existing menyesuaikan binding handler.

## Verifikasi

Hasil akhir:

| Pemeriksaan | Hasil |
| --- | --- |
| 28 suite Step 07–08, mapping import/apply/persistence, semantic evidence dan readiness | PASS setelah rerun checkpoint |
| `testStep07TargetUnit.ts` pada kode final | PASS 12/12 |
| `testStep07HybridCheckpoint.ts` pada kode final | PASS 20/20 |
| `testStep07ProgressPersistence.ts` pada kode final | PASS 7 skenario |
| `npm run lint` (TypeScript `tsc --noEmit`) pada kode final | PASS |
| `npm run build` pada kode final | PASS; peringatan bundle frontend >500 kB |
| `git diff --check` | PASS |
| Gemini live / interaksi browser end-to-end | BELUM DIUJI |

Runner batch pertama menghentikan suite checkpoint setelah 180 detik saat build berjalan bersamaan; 27 suite lainnya lulus. Suite checkpoint dijalankan ulang sampai selesai pada kode final, tanpa mengubah guard timeout aplikasi. Suite target dan progres juga dijalankan ulang setelah pemeriksaan dependensi buffer terakhir. Log sementara berada di `tmp/` yang diabaikan Git.

Suite target mencakup:

1. Fixture PJOK 9 Bab/27 materi: 6/9 → 7/9 setelah memperbaiki Bab 1; Bab lain identik, reload/backup mempertahankan hasil; Step 08 tetap terkunci karena readiness global belum lengkap.
2. Timeout/API gagal dan respons terlambat mempertahankan V5 serta checkpoint.
3. Edit manual Bab lain tetap di draft dan tidak ikut disimpan.
4. Edit target belum terverifikasi tidak diam-diam disimpan jika AI gagal.
5. Konflik sumber/manual gagal aman; edit yang tidak konflik dipertahankan.
6. Aksi Bab lain/lintas-Bab ditolak sebelum verify/apply dan tidak masuk GLOBAL.
7. Buffer Bab lain dipertahankan; analisis seluruh Bab tetap dapat melanjutkan sampai readiness global lengkap dengan provider simulasi.
8. Resume bukti/histori terverifikasi tanpa perubahan graph tetap disimpan.
9. Eksekusi ganda serta target hilang/kosong ditolak aman.
10. Undo Bab selain Bab pertama tidak mengubah isi/histori Bab lain.
11. Sembilan tombol UI, dispatch target, busy guard, hasil lokal, dan pesan kegagalan penyimpanan.
12. Buffer Bab lain tetap tersimpan tetapi tidak dapat dipulihkan bila dependensi kanonikalnya sudah berubah. Pemeriksaan dependensi dilakukan sebelum restorasi buffer, bukan hanya setelahnya.

## Batas pembuktian

Pengujian ini menggunakan provider/verifier simulasi. Tidak membuktikan kualitas rekomendasi Gemini live, kredensial/kuota server, atau keberhasilan deployed AI Studio. Fixture berasal dari proyek nyata, tetapi tindakan perbaikannya disimulasikan secara eksplisit. SSR dan handler contract bukan pengujian interaksi browser end-to-end. Tidak ada deploy atau push dalam tugas ini.
