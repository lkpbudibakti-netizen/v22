# Step 08 — akses Produksi terpisah dari kelayakan tindakan

Tanggal: 15 November 2026. Repository: lkpbudibakti-netizen/v22, branch main.
Baseline: 5d064cd5b270d071fecdcfe1fe9a1ec8ab393385. Working tree awal bersih.

## Akar masalah berdasarkan kode baseline

- `AnnualPlanningManager.tsx:111`: resolver readiness Step 07 tetap mensyaratkan status SIAP, tidak needsReview, sumber tidak stale dan kelengkapan pemetaan. Itu tepat untuk Penyusunan, tetapi hasilnya juga dipakai sebagai izin membuka halaman Produksi.
- `AnnualPlanningManager.tsx:586`: early return menghilangkan seluruh isi Step 08 saat canProceed false.
- `annualTasks` mengunci Pembagian Bab dan Struktur Pertemuan berdasarkan tugas sebelumnya; effect activeTaskId mengembalikan pengguna dari tugas yang terkunci. Rail desktop memakai isLocked. `nextStepCTA` dan tombol lanjut antarbagian juga memakai readiness sebagai izin navigasi.
- Rail mobile selalu memilih tugas pertama yang belum lengkap, sehingga Produksi bisa kembali ke tugas yang sama meskipun ingin melanjutkan inspeksi bagian lain.
- Komponen anak tidak memiliki syarat TP/ATP SIAP atau needsReview. Mereka memiliki guard struktur, referensi, kalender, kapasitas aktual dan jadwal. Guard tindakan ini tidak boleh ikut dilepas ketika akses halaman dibuka.
- UnitSemesterPlanningManager dan UnitExecutionPlanManager menolak simpan hanya karena versi pemetaan stale, sekalipun semua referensi masih sah, sehingga sebelumnya mendorong sinkronisasi/buat ulang.

## Perubahan

1. Produksi melewati pengunci akses halaman, rail prerequisite dan CTA; status selesai tetap berdasarkan data aktual. Mode Normal tetap memakai resolver dan pengunci lama. Tidak ada pemaksaan canProceed atau status workflow.
2. Rail mobile Produksi bergerak sesuai urutan bagian dan dapat kembali ke awal, tanpa menunggu suatu bagian selesai. Normal tetap memakai perilaku sebelumnya.
3. Guard tindakan khusus boundary Step 08 menggunakan validator canonical existing, pemeriksaan referensi existing, serta identitas konteks dan isi TP minimum. ID TP/ATP/unit rusak, parent berbeda, atau sumber minimum hilang ditampilkan pada bagian terkait dan tidak diperlakukan sebagai WARNING.
4. Bagian waktu/kalender dan pemilihan semester tetap dapat dibuka. Alokasi/jadwal yang bergantung pada referensi rusak tidak dihitung/disimpan. Kalender dan slot tanggal tetap menggunakan guard existing; tidak dibuat dari estimasi atau data hilang.
5. Stale saja menjadi peringatan pada UI Produksi. Simpan eksplisit yang lolos validasi referensi mengirim salinan kandidat dengan basis versi mapping saat ini ke callback/V5 existing. Tidak ada rebase atau penulisan saat render/navigasi. Validator V5, proteksi referensi faktual dan pemeriksaan konflik/concurrency tidak diubah.
6. Simpan ulang stale yang masih sah tidak mengharuskan edit redaksi terlebih dahulu. Normal tetap menolak stale seperti sebelumnya. Tindakan AI tidak dipanggil untuk membuka atau berpindah bagian.

Tidak ada perubahan pada `src/services`, `src/types`, skema penyimpanan, CP/Analisis CP/TP/ATP kanonikal, atau dependensi aplikasi.

## Pengujian

| Pemeriksaan | Hasil / bukti |
| --- | --- |
| Produksi DRAFT, needsReview, stale CP/analisis, cakupan tekstual, metadata kompetensi berbeda | PASS; kasus gabungan dan masing-masing terpisah menggunakan AnnualPlanningManager aktual |
| Lima bagian Step 08, rail desktop/mobile, CTA, effect pemilihan tugas | PASS; tidak bounce ke prerequisite, tidak memberi status selesai palsu |
| Kalender/jadwal hilang | PASS; waktu semester tetap terbuka, komponen TimePlanningManager aktual tidak mengisi tanggal rekaan |
| Referensi TP/ATP/unit rusak, konteks berbeda, mapping hilang | PASS; halaman tetap terbuka, tindakan terkait ditolak dengan ID/alasan spesifik |
| Navigasi tidak mengubah proyek atau memanggil AI | PASS; snapshot sumber dan penyimpanan identik, nol write/save dan nol fetch |
| Simpan eksplisit stale yang referensinya valid | PASS; handler anak aktual, wrapper parent, saveUnitExecutionPlanV5 dan reload diuji. Sumber CP/analisis/TP/ATP/mapping tidak berubah |
| Kandidat save memiliki unit orphan | PASS; ditolak sebelum callback penyimpanan |
| Normal readiness dan prerequisite masih terkunci | PASS; actual parent, rail dan child save handler diuji; validator global tetap tidak diubah |
| `npm.cmd run test:step08-production` | PASS |
| `npm.cmd run test:step08-jp` | PASS; termasuk kalender, JP aktual, kedua semester, handler dan ZIP import/export |
| `testMerdekaV5SemesterNavigation.ts` | PASS 25/25 |
| `npm.cmd run ci:tests -- planning` | PASS 20/20 suite, termasuk regresi Step 07, meeting alignment, kalender dan alokasi semester |
| `npm.cmd run test:production-validation` | PASS untuk skenario yang tersedia; skenario 10 PAI V6.1 SKIP karena fixture tidak tersedia |
| `npm.cmd run test:work-modes` | PASS |
| `npm.cmd run lint` / typecheck | PASS (`tsc --noEmit`) |
| `npm.cmd run build` | PASS frontend, PWA dan server; peringatan ukuran bundle existing tetap ada |

Tes baru mengeksekusi komponen/handler Step 08 aktual dengan hook deterministik dan resolver/storage nyata, bukan hanya WorkflowStepper. Helper tes diperluas untuk menjalankan effect parent; tes alokasi lama mendapat binding default allocationBlockers kosong sesuai closure baru. Tidak ada ekspektasi validasi yang dilonggarkan. Tidak ada kegagalan pada verifikasi terkait yang dijalankan.

## Batas dan risiko

- Browser interaktif/responsive visual serta Gemini live belum diuji. SSR dan handler tidak membuktikan seluruh perilaku browser.
- PAI V6.1 tetap tidak terverifikasi karena fixture tidak tersedia; tidak digantikan fixture versi lain.
- Keterbukaan halaman tidak menjamin data dapat dihitung atau disimpan. Kalender aktual, referensi valid dan proteksi V5 tetap wajib pada tindakan terkait.
- Save eksplisit tetap dapat ditolak V5 jika sumber berubah serentak atau data faktual terlindungi; tidak ada bypass. Navigasi sendiri tidak menulis apa pun.
- Suite CI penuh di luar kelompok planning tidak dijalankan ulang untuk perubahan UI ini; tes Produksi dan dua mode dijalankan terpisah sesuai tugas.

## File berubah

- `src/components/AnnualPlanningManager.tsx`
- `src/components/AnnualPlanningTaskRail.tsx`
- `src/components/UnitSemesterPlanningManager.tsx`
- `src/components/UnitExecutionPlanManager.tsx`
- `src/components/administration/TimePlanningManager.tsx`
- `scripts/testStep08ProductionAccess.tsx`
- `scripts/fixtures/annualPlanningManagerHarness.ts`
- `scripts/testAutoSemesterTimeAllocation.ts`
- `scripts/ci/test-groups.json`
- `package.json`
- Laporan audit ini.

Commit lokal khusus perbaikan ini; tidak ada push.
