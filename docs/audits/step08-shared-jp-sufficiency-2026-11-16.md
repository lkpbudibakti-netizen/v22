# Step 08 — aturan kecukupan JP bersama

Baseline `70793636872737f7cc6d990d0372faf817282e42`; repository `lkpbudibakti-netizen/v22`, branch `main`. Working tree bersih sebelum pengerjaan.

## Akar masalah

1. `AnnualPlanningManager.tsx`: penilaian kecukupan, subset slot aktual, dan klasifikasi ERROR/REVIEW hanya aktif bila `productionMode` true. Normal memakai kontrak lama, sehingga perencanaan yang sama memberi hasil berbeda.
2. `learningMeetingScheduleService.ts` dan `storageV5.ts`: default penyimpanan/validasi masih memasangkan jadwal AUTO dengan awalan daftar slot, sedangkan Produksi mengaktifkan relasi eksplisit melalui opsi. Normal berisiko menolak celah yang sebenarnya sah. Proteksi slot juga sebelumnya hanya berjalan dengan opsi Produksi.
3. Preview, layanan impor, dan kebijakan waktu impor meneruskan mode ke validator slot. `UnitExecutionPlanManager.tsx` menguji no-work berdasarkan kapasitas penuh.
4. `workflowEngine.ts`: penilaian JP resmi hanya dijalankan pada Produksi. Cabang lama Normal juga memakai kelengkapan pemetaan yang menganggap ATP berulang antar-Bab sebagai penghalang; itu berbeda dari resolver pemetaan kanonikal halaman yang mengizinkan penggunaan relevan pada beberapa Bab.
5. `promesPresentation.ts`: sisa kapasitas positif diformat sebagai “Alokasi belum terpenuhi”, walau bukan kekurangan terhadap acuan resmi.

## Perubahan minimal

- Fungsi bersama `assessJPSufficiency` menggantikan penamaan khusus Produksi. Nama lama dipertahankan sebagai alias fungsi yang sama, bukan engine kedua.
- Kedua mode memakai acuan resolver resmi, alokasi jadwal tersimpan, kapasitas aktual setiap semester, kelengkapan cakupan, relasi kanonikal, dan jadwal kedua semester. Acuan ZIP impor tidak menjadi otoritas regulasi.
- Langkah 4/5, ringkasan halaman, dan indikator Step 08 memakai hasil kecukupan yang sama. Normal tetap memerlukan sumber ATP/TP beserta dependensi hulunya SIAP/tidak stale dan resolver pemetaan siap. Produksi tetap memakai kebijakan WARNING/navigasi existing; ERROR substansi tidak dipromosikan menjadi selesai.
- Default validasi/save jadwal menggunakan `meetingId → sourceSlotId`; preview COMPLETE dan impor mempertahankan relasi tersebut pada kedua mode. Proteksi tanggal/sesi/JP berjalan tanpa memerlukan flag mode.
- Konteks penyesuaian mengaktifkan relasi tersimpan ketika relasi tersedia. Bab/semester yang belum pernah memiliki jadwal tetap dapat dipratinjau dengan alur penyiapan kalender existing. Relasi yang hanya terisi sebagian dalam semester tetap gagal bila ada pertemuan tak teralokasi; tidak disulap menjadi lengkap.
- No-work untuk subset valid diperiksa sebelum menyiapkan regenerasi kalender; tidak memanggil AI atau membuat pertemuan tambahan. “Regenerate” eksplisit dan persetujuan guru existing tetap dipertahankan.
- Format bersama PROMES/Alokasi Waktu menyebut sisa kapasitas sebagai informasi. Angka, substansi, proyeksi, snapshot, dan skema ZIP/V5 tidak berubah.

## Peta allowUnusedSlots dan pemeriksaan persis

`AnnualPlanningManager`, `LearningMeetingSchedulePreview`, no-work `UnitExecutionPlanManager`, `workflowEngine`, `administrationProjectImportService`, dan `administrationImportPolicy` memakai subset untuk kedua mode. Validator jadwal dan proteksi save V5 menggunakannya secara default; App memakai kontrak save dua argumen pada kedua mode. `getMeetingAlignmentSourceV5` menurunkan opsi dari keberadaan relasi jadwal, bukan mode.

`unitMeetingAllocationService` tidak perlu diubah: opsi subset commit baseline sudah benar. Kontrak persis tetap digunakan pada pembuatan kandidat full-calendar yang diminta guru secara eksplisit dan validasi persetujuannya. Itu bukan syarat kesiapan Step 08. Kesamaan metadata jumlah/total slot terhadap kalender sumber, pembandingan baris jadwal dengan slot yang dirujuk, larangan duplikasi/benturan/urutan terbalik, serta proteksi konten tetap ketat.

Audit tanpa perubahan: `meetingContentService`, `subjectScheduleService`, `unitExecutionPlanService`, `WorkflowStepper`, `TimePlanningManager`, `annualZipPlan`, PROTA/PROMES/Alokasi Waktu projections. Mereka sudah memakai helper/sumber dan jadwal tersimpan yang sesuai; penerusan mode di WorkflowStepper tetap diperlukan untuk kebijakan WARNING, bukan rumus JP.

## Perbandingan mode

| Kondisi | Normal | Produksi Paket |
|---|---|---|
| Acuan 108, alokasi 108, kapasitas 129, sumber/perencanaan valid | SELESAI | SELESAI |
| Alokasi 99 dari acuan 108 | REVIEW, tidak finalisasi | REVIEW; navigasi tetap tersedia |
| Alokasi 135, kapasitas 129 / satu semester kelebihan | ERROR | ERROR |
| Acuan belum terverifikasi / jadwal semester belum lengkap | REVIEW | REVIEW |
| TP/ATP atau analisis hulu membutuhkan review | Pengunci dependensi tetap berlaku | WARNING sesuai kebijakan existing, tanpa memalsukan substansi |
| Referensi/jadwal rusak | Tindakan terkait ditolak | Tindakan/dokumen terdampak ditolak; navigasi tetap terbuka |
| Slot tersisa | Informasi | Informasi |

Ekspor Normal tetap menjalankan validasi kelengkapannya. Produksi tetap mempertahankan klasifikasi WARNING minor dan ZIP parsial existing. Kesiapan dokumen bukan sertifikat kelulusan seluruh tahapan; keduanya memakai baris alokasi yang sama tanpa mengisi sisa slot.

## Daftar file berubah

- UI: `src/App.tsx`, `src/components/AnnualPlanningManager.tsx`, `src/components/LearningMeetingSchedulePreview.tsx`, `src/components/UnitExecutionPlanManager.tsx`.
- Layanan: `src/services/annualJPAssessment.ts`, `src/services/workflowEngine.ts`, `src/services/learningMeetingScheduleService.ts`, `src/services/meetingAlignmentService.ts`, `src/services/storageV5.ts`, `src/services/administrationImportPolicy.ts`, `src/services/administrationProjectImportService.ts`.
- Presentasi dokumen: `src/services/documentEngine/promesPresentation.ts`.
- Tes/fixture: `scripts/testStep08JPSufficiency.tsx`, `scripts/testStep08JPIntegration.tsx`, `scripts/testMerdekaV5SemesterNavigation.ts`, `scripts/fixtures/v21ReadyWorkflowFixture.ts`.
- Laporan ini: `docs/audits/step08-shared-jp-sufficiency-2026-11-16.md`.

## Pengujian dan penyesuaian fixture

`testStep08JPSufficiency.tsx` menguji matriks kedua mode pada komponen/handler dan workflow aktual: 108/108/129, 108/99/129, 108/108/108, 108/135/129, kelebihan satu semester, acuan tidak dikenal, dan semester belum tersimpan. Termasuk celah awal/tengah/akhir, proteksi pertemuan, duplikasi/rujukan rusak, TP belum tercakup, Normal review/stale, WARNING Produksi, no-work tanpa panggilan AI, save/reload, hasil DOCX/PDF tiga dokumen, dan roundtrip ZIP berformat existing tanpa perubahan tanggal/JP.

Fixture navigasi yang sebelumnya dianggap selesai pada 6 JP disesuaikan menjadi 108 JP kalender representatif. Fixture penyiapan kalender membuang placeholder warisan sebelum membuat jadwal pertamanya; tidak melakukan perpindahan jadwal terlindungi. Tes integrasi dengan 6/10 JP sekarang mengharapkan REVIEW/tidak selesai, termasuk sesudah review acuan dan impor ulang. Kegagalan intermediate diperbaiki pada kontrak/setup yang salah, bukan dengan menurunkan acuan atau melemahkan validator.

Verifikasi akhir:

| Pemeriksaan | Hasil |
|---|---|
| `npm.cmd run lint` / TypeScript `tsc --noEmit` | PASS |
| `npm.cmd run build` — frontend, PWA, server | PASS; warning ukuran bundle existing |
| `npm.cmd run test:step08-jp-sufficiency` | PASS; kedua mode dan handler no-work aktual |
| `npm.cmd run test:step08-jp` | PASS; review acuan tidak meloloskan kekurangan JP |
| `npm.cmd run test:workflow` | PASS |
| Navigasi/storage handler Step 08–10 | PASS 25/25 |
| Penyesuaian pertemuan existing | PASS 46 kasus |
| `npm.cmd run ci:tests -- all`, pemanggilan akhir | PASS 61/61 suite: storage 24, planning 21, documents 11, transport 5 |
| `git diff --check` | PASS |

CI awal mendeteksi dua masalah: setup jadwal terlindungi pada fixture navigasi, serta aktivasi subset pada semester yang belum mempunyai jadwal. Setelah perbaikan terarah dan penyesuaian ekspektasi yang memang berubah, CI lengkap dijalankan ulang dan lulus. Log rinci berada pada `artifacts/ci/` dan folder `tmp/` yang diabaikan Git, tidak dimasukkan commit.

## Batas bukti

Pengujian memakai fixture representatif dan ZIP hasil fixture dalam format existing, bukan arsip historis pengguna/PAI V6.2. DOCX benar-benar dibuat lalu dibuka sebagai ZIP/XML; PDF dibuat lalu teks hasilnya diperiksa untuk total alokasi dan ketiadaan klaim kekurangan akibat slot tersisa. Browser interaktif, Gemini live, serta pagination/TTD visual Word/LibreOffice tidak diuji. Tidak ada klaim keberhasilan pada batas tersebut.
