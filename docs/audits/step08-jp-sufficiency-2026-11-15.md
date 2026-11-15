# Step 08 — kecukupan JP Mode Produksi Paket

Baseline: `411281db8d51f6e6ff3abc080846e676520b6ce3`, branch `main`, remote `lkpbudibakti-netizen/v22`.

## Akar masalah dan batas perubahan

- `AnnualPlanningManager.tsx`: status Struktur Pertemuan mensyaratkan jumlah pertemuan sama dengan seluruh slot kalender. Penilaian JP tahunan sebelumnya bersifat informasi, belum menjadi keputusan kecukupan Produksi. Kini Langkah 4 dan 5 memakai `assessProductionJPSufficiency`: acuan resmi terverifikasi, cukup JP, tidak melampaui kapasitas masing-masing semester, lineage/cakupan valid, serta jadwal kedua semester lengkap dan tersimpan.
- `annualJPAssessment.ts`: membedakan acuan resmi, kapasitas aktual, alokasi tersimpan, dan sisa kapasitas. Acuan master impor tidak menggantikan hasil resolver regulasi resmi. Kekurangan/ketidakpastian adalah REVIEW; kerusakan relasi/jadwal dan kelebihan semester adalah ERROR.
- `unitMeetingAllocationService.ts`: kandidat sebelumnya wajib memenuhi jumlah slot, JP tiap slot, dan total kapasitas penuh. Opsi Produksi memvalidasi subset slot yang dipakai dengan relasi eksplisit; metadata kapasitas penuh tetap diperiksa integritasnya.
- `learningMeetingScheduleService.ts`: resolver/validator AUTO sebelumnya memasangkan pertemuan dengan awalan daftar slot. Akibatnya celah kalender tersimpan dianggap tidak konsisten. Opsi Produksi memakai `meetingId → sourceSlotId` yang sudah tersimpan, menolak slot hilang/ambigu/duplikat dan urutan terbalik. Validasi kelengkapan tetap memeriksa rencana asli; salinan subset hanya untuk pembandingan baris jadwal parsial.
- `meetingContentService.ts`: helper pemilihan slot bersama; tidak memadatkan kalender atau memutasi sumber.
- `meetingAlignmentService.ts`: simulasi dan proteksi tanggal/sesi/JP memakai slot terpilih dalam Mode Produksi. Preview dan persetujuan memakai flag yang sama; flag tidak disisipkan sebagai `false` pada konteks Normal karena itu mengubah fingerprint.
- `storageV5.ts`: relasi slot diturunkan dari jadwal existing. Penyimpanan Produksi meneruskan opsi validator dan melindungi tanggal/sesi/JP pertemuan yang telah dipakai dokumen/realisasi. Tidak ada perubahan skema storage, ZIP, atau data kanonikal.
- `WorkflowStepper.tsx`/`workflowEngine.ts`: indikator Step 08 ikut memakai kecukupan Produksi dan validasi jadwal eksplisit. Status DRAFT/review TP/ATP bukan sertifikat maupun penghalang tersendiri; referensi, identitas, cakupan kanonikal dan jadwal aktual tetap diperiksa. Default Normal tidak berubah.
- `App.tsx`, `LearningMeetingSchedulePreview.tsx`, `TimePlanningManager.tsx`, `UnitExecutionPlanManager.tsx`, dua layanan impor: meneruskan opsi Produksi melalui alur existing. Kontrak pemanggilan dua argumen Normal dipertahankan.
- `AnnualPlanningTaskRail.tsx`: menampilkan ERROR untuk kerusakan nyata, terpisah dari REVIEW dan informasi sisa kapasitas.

Audit `subjectScheduleService.ts` dan `unitExecutionPlanService.ts`: tetap menjadi sumber slot aktual, identitas, urutan, kelengkapan materi/TP/ATP dan pembagian semester; tidak diubah. Audit `annualZipPlan.ts`, proyeksi PROTA/PROMES/Alokasi Waktu: sudah memakai jadwal/alokasi tersimpan, sehingga tidak perlu perubahan generator.

Perbandingan persis yang dipertahankan: integritas jumlah/total slot sumber terhadap metadata kapasitas; pembandingan setiap baris jadwal terhadap slot aktualnya; perlindungan konten/tanggal/sesi/JP; seluruh kontrak Normal. Generator AI eksplisit “Regenerate dari Kalender” masih memiliki kontrak full-calendar existing dan membutuhkan tindakan/persetujuan guru. Menjalankannya bukan syarat selesai Produksi; patch ini tidak memanggilnya atau menambahkan pertemuan otomatis.

## Pengujian

`scripts/testStep08JPSufficiency.tsx` menggunakan fixture dua semester, kalender aktual representatif PJOK kelas 2: 63+66 JP tersedia, 54+54 JP tersimpan, acuan resolver resmi 108 JP. Nilai master impor sengaja 999 untuk mendeteksi penggunaan acuan yang salah.

| Kasus | Hasil |
|---|---|
| Acuan 108, alokasi 108, kapasitas 129 | PASS — SELESAI; halaman dan indikator workflow konsisten |
| 108 / 99 / 129 | PASS — REVIEW |
| 108 / 135 / 129 | PASS — ERROR |
| 108 / 108 / 108 | PASS — SELESAI |
| Total cukup, salah satu semester melebihi kapasitas | PASS — ERROR |
| Acuan belum terverifikasi / semester belum tersimpan | PASS — REVIEW |
| Slot kosong di tengah kalender | PASS — tanggal pertemuan tidak bergeser; V5 save/reload mempertahankannya |
| Pertemuan terlindungi | PASS — perubahan ke slot lain yang valid ditolak; sumber/konten tetap |
| Materi rusak / TP kanonikal belum tercakup | PASS — tidak selesai; JP cukup tidak menutupi coverage hilang |
| PROTA/PROMES/Alokasi Waktu | PASS — hasil DOCX dibuka sebagai ZIP/XML dan PDF diekstrak; total 108/54/54 sesuai proyeksi alokasi tersimpan |
| Normal | PASS — kontrak slot awalan/penuh tetap, callback penyimpanan tetap dua argumen |

Tes terdaftar pada grup CI planning. Suite penyesuaian pertemuan baseline terpisah lulus 46 kasus; setelah koreksi fingerprint Normal, suite yang sama lulus 46 kasus pada perubahan ini. Kegagalan intermediate tidak diatasi dengan pelemahan validator.

Verifikasi akhir: `npm.cmd run lint` (TypeScript `tsc --noEmit`) PASS; `npm.cmd run build` PASS (frontend, PWA, server; peringatan ukuran bundle tetap ada). Seluruh grup CI dijalankan: storage 24/24, documents 11/11, transport 5/5 PASS. Pemanggilan awal grup planning menemukan regresi fingerprint Normal tersebut; setelah koreksi, seluruh grup planning dijalankan ulang dan 21/21 PASS. Total hasil akhir 61/61 suite PASS. `test:workflow` dan `test:step08-jp-sufficiency` juga dijalankan ulang setelah sinkronisasi workflow/coverage dan PASS. `git diff --check` PASS. Hasil rinci/log lokal berada pada `artifacts/ci/` dan folder sementara yang diabaikan Git; tidak dimasukkan commit.

## Batas bukti

Fixture PAI V6.2 tidak tersedia untuk pengujian ini: SKIP. Tidak ada klaim uji impor PAI nyata, Gemini live, browser interaktif, atau render visual Word/LibreOffice. Pemeriksaan ekspor benar-benar menjalankan generator DOCX/PDF dan memeriksa isi hasilnya, tetapi tidak membuktikan pagination/TTD secara visual pada semua renderer. Tidak ada perubahan otomatis pada CP/TP/ATP/Bab/kalender/jadwal/modul ajar.
