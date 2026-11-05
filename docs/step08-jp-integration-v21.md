# Integrasi JP Step 08 V21

Baseline `281f3dc973cdf4a5d44a9e9c98818f69abd89b5d`, branch `main`, remote `pkbmcwd92-cpu/Alco-Adm-v21-Penyesuaian-JP-dan-Jadwal`. Checkout awal bersih. Perubahan lokal; tidak commit/push.

## Audit caller sebelum perubahan

| API | Caller produksi yang ditemukan | Keputusan |
|---|---|---|
| `assessAnnualJP`, `sumSemesterAllocatedJP` | `AnnualPlanningManager.tsx` | Gunakan fungsi existing; kontrak hasil tidak diubah. Jumlah canonical schedule tetap didahulukan, legacy time allocation tetap didukung. |
| `resolvePlannedMeetingCapacity` | `AnnualPlanningManager.tsx`, `workflowEngine.ts`, `SubjectWeeklyScheduleManager.tsx` | `isReady` estimasi tetap dipertahankan untuk pratinjau/draf. Tambahkan predicate final yang terpisah di service existing. |
| `isLearningMeetingScheduleReady` | `AnnualPlanningManager.tsx`, `workflowEngine.ts` | Tidak mengubah kontrak. Tetap memvalidasi COMPLETE, unresolved IDs, lineage/staleness dan hasil validator slot aktual. |
| `resolveSemesterCapacityV5` / resolver JP semester | App, Step 08, TimePlanningManager, workflow, ekspor/import dan konsumen dokumen | Tidak diubah; angka estimasi tidak lagi ditampilkan sebagai kapasitas aktual pada ringkasan tahunan. |
| `AnnualJPReference` persistence | `saveAnnualJPReferenceV5`, save Data Pembelajaran di App; runtime V5 dan import/export menyimpan array scoped tahunan | Jalur review baru memakai writer existing, hanya atas tindakan eksplisit. Schema/import/export tidak diubah. |

Tidak ada perubahan global `isReady`. Task pratinjau/pembagian Bab/struktur masih dapat memakai estimasi. Final CTA Step 08 dan status COMPLETE workflow memerlukan slot aktual kedua semester serta jadwal canonical yang valid.

## Implementasi

- `src/services/annualJPAssessment.ts`: tambah pembanding murni `compareAnnualJPReference`. Acuan master hanya disahkan jika lookup resmi dan angka finite. Perbedaan tersimpan ditampilkan, bukan diperbaiki saat render.
- `src/components/AnnualPlanningManager.tsx`: ringkasan status VERIFIED/UNVERIFIED, intra tahunan resmi, JP rencana/teralokasi, kapasitas aktual, kedua selisih dan kekurangan kapasitas. ESTIMATE/EFFECTIVE_DAY_ESTIMATE hanya diberi label pratinjau/draf; kapasitas aktual yang belum diketahui tetap UNRESOLVED. Nol JP yang sudah terhitung tetap nol, bukan unresolved.
- Peringatan membandingkan referensi tahunan tersimpan dengan master sesuai kurikulum, jenjang, kelas, mapel dan TA pada YearPlan. Nilai mingguan tersimpan juga diperlihatkan bersama ekuivalen master, dengan penjelasan bahwa itu bukan batas sesi dan tidak ikut diubah.
- `src/services/storageV5.ts`: `reviewAnnualJPReferenceV5(yearPlanId)` membaca identitas YearPlan tersimpan, memanggil resolver regulasi existing, menolak master tidak resmi/identitas tidak lengkap, lalu memperbarui **hanya** `officialAnnualJP` dan `regulationReference` melalui `saveAnnualJPReferenceV5`.
- `src/App.tsx`: menghubungkan tindakan eksplisit review ke service, memeriksa ID tahun aktif, menangani kegagalan dan refresh V5 setelah sukses.
- `src/services/subjectScheduleService.ts`: predicate `isActualPlannedCapacityReady` memerlukan ACTUAL_SLOTS, ready, valid, complete, tidak stale dan JP finite positif. Predicate tidak menggantikan `isReady` preview.
- `src/services/workflowEngine.ts`: completion Waktu S1/S2 untuk final workflow memakai predicate tersebut; alasan belum siap menjelaskan kebutuhan kalender/hari mengajar aktual. Step 09 tetap diblokir saat finalisasi Step 08 belum siap.
- Final CTA memakai seluruh task readiness (`isAnnualReady`), bukan Task 5 saja. Callback ikut memeriksa gate, sehingga memanggil callback tombol yang disabled tidak meneruskan navigasi.
- `scripts/testStep08JPIntegration.tsx`, `scripts/fixtures/annualPlanningManagerHarness.ts`, `package.json`: regression khusus `npm.cmd run test:step08-jp`.

Master regulasi, CP/TP/ATP engine, prompt AI, generator dokumen dan mekanisme import/export tidak diubah. Tidak ada engine baru.

## Perlindungan data dan arti status

Memperbarui weekly equivalent lama dapat mengubah fallback kapasitas semester yang belum memiliki override. Karena itu tindakan bernama **Perbarui acuan tahunan saja** sengaja mempertahankan `referenceWeeklyEquivalentJP` dan `weeklyJPSource`. Guru meninjau pola sekolah secara terpisah lewat mekanisme existing.

Tidak ada perubahan otomatis jadwal, override semester, kalender, TP/ATP/Bab, isi pertemuan, atau data semester lain. Test membandingkan seluruh objek V5 sebelum/sesudah review: hanya AnnualJPReference yang berbeda. Render tidak menulis storage. Master tidak terverifikasi menolak review tanpa satu pun perubahan pada payload tersimpan.

- VERIFIED/UNVERIFIED menjelaskan kepastian **master acuan**.
- UNRESOLVED menjelaskan angka kapasitas/alokasi yang belum dapat diketahui, bukan keputusan pelanggaran.
- `kapasitas − alokasi < 0` berarti kelebihan alokasi terhadap kapasitas; saldo per semester tetap diperiksa.
- `acuan − alokasi` menjelaskan selisih rencana dengan target resmi; tidak otomatis memblokir finalisasi atau dianggap pelanggaran.
- Kekurangan kapasitas terhadap acuan ditampilkan terpisah. Contoh fixture Matematika: target 180, kapasitas aktual 10, alokasi 10; saldo kapasitas seimbang dan selisih acuan 170. Finalisasi dapat siap karena data slot benar, tanpa mengklaim pemenuhan seluruh target tahunan.

## Bukti jalur finalisasi

Tes baru menjalankan **kode komponen AnnualPlanningManager yang sebenarnya**, callback tombol dan rail, seluruh resolver produksi, workflow, writer/reloader V5, serta ZIP encode/decode/import produksi. Hook React dibuat deterministik untuk pengujian; child editor digantikan penanda komponen. Ini merupakan bukti handler/integrasi, bukan visual QA browser atau pengujian klik end-to-end pada aplikasi terpasang.

Kasus yang diuji:

1. PJOK SD 3 JP/minggu; referensi lama 144 dibanding master 108. Render tidak menulis. Klik review memperbarui hanya acuan tahunan dan mempertahankan default mingguan/override/substansi. Reload tetap final-ready.
2. Matematika SD 5 JP/minggu, pola 3+2; entri aktual tetap 3 dan 2. Target resmi berbeda dari kapasitas aktual tidak disamakan dengan pelanggaran/final blocker.
3. Pola tanpa weekday dapat disimpan sebagai draf dan resolver masih `isReady=true`, `capacitySource=ESTIMATE`. UI final disabled, callback final tidak meneruskan, workflow belum COMPLETE dan Step 09 blocked.
4. Weekday dipulihkan dan jadwal aktual disimpan melalui writer existing: transisi ESTIMATE → ACTUAL_SLOTS mengaktifkan finalisasi.
5. Libur di luar hari mapel tidak mengurangi JP; libur pada hari mapel mengurangi kapasitas. Kapasitas nol tetap terhitung. Perubahan S1 tidak memodifikasi data S2; jadwal lama tidak diterima sebagai final yang masih valid.
6. Pancasila SMA XI 2024/2025: 54 JP/tahun, ekuivalen 1,5. Review mempertahankan 1,5, override sekolah 2 JP tetap dipakai sebagai slot integer. Tanpa override, kapasitas unresolved; pecahan tidak dijadikan satu sesi.
7. Backup serialize/parse dan reload V5 mempertahankan final-ready. ZIP proyek benar-benar dibuat, dibaca, diimpor CONTINUE_EDITING ke profil/sekolah lain, dan diuji setelah remapping ID. Kedua jadwal semester, referensi 54, status workflow COMPLETE, Step 09 unblocked, dan callback final hasil impor lulus.
8. Master tidak dikenal: status UNVERIFIED dan review ditolak tanpa mengubah storage.
9. PAI SMP VII dengan default/override lama 3 JP: review mengubah acuan tahunan menjadi 72, tetapi default 3, kedua override, semua data semester dan kapasitas mingguan tetap dipertahankan, walaupun ekuivalen master adalah 2.

## Pengujian

Lulus:

- `npm.cmd run test:step08-jp`.
- `npm.cmd run test:jp-regulation-v21` (493 rule; master tetap tidak diubah).
- `tsx scripts/testStep7Step8LineageRegression.ts`.
- `npm.cmd run test:workflow`.
- `tsx scripts/testCalendarJpIntegrationRegression.ts`.
- `tsx scripts/testJPFoundationRegression.ts` (termasuk generator dokumen existing tanpa modifikasi; warning lebar tabel existing).
- `tsx scripts/testCalendarJpRegression.ts`.
- `tsx scripts/testStorageV5AnnualCrud.ts`: 9/9, termasuk outer scope authority dan persistence round-trip.
- `npm.cmd run build`: frontend Vite, PWA dan server esbuild lulus; warning ukuran bundle >500 kB.
- `git diff --check`: lulus.

Pemeriksaan global yang dilaporkan terpisah:

- `npm.cmd run lint`: 67 diagnostic pada fixture existing, tanpa diagnostic pada file produksi yang diubah atau tes/harness baru. Pola/count ini sama dengan batas baseline yang sudah dicatat pada audit JP sebelumnya. Tidak memperbaiki CP engine atau fixture di luar scope.
- `npm.cmd run test:curriculum`: bagian JP lolos; berhenti pada assertion sumber CP historis 2024/2025 (`DEC-BSKAP-032-2024`), masalah yang sudah dicatat pada audit sebelumnya. Tidak dilonggarkan agar hijau.

Log hasil tersimpan lokal di `tmp/jp-step08/` (diabaikan Git). Tidak ada dependency atau lockfile yang diubah.

## Kesiapan dan risiko tersisa

Jalur finalisasi Step 08 sudah diuji pada batas handler komponen + workflow + persistence/reload + import/export produksi. Draf tetap dapat disimpan. Finalisasi tidak menyamakan target regulasi dengan kapasitas kalender dan tidak mengubah alokasi pengguna untuk mengejar target.

Belum dilakukan visual QA/browser klik end-to-end, pengujian data pengguna nyata, atau pemeriksaan CI remote. Data canonical schedule yang masih DRAFT/stale tetap dapat tampil sebagai jumlah rencana/teralokasi (jelas diberi label draf); gate final memakai validator exact secara terpisah. Review annual saja tidak memperbaiki default mingguan lama; ini batas yang disengaja untuk melindungi jadwal. Gap master UNVERIFIED dari audit sebelumnya tetap berlaku dan tidak dipromosikan.
