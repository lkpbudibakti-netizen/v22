# Produksi Paket — identitas, kalender, dan hari mengajar

Baseline `cb48537819bb3db15ca14fee2934a768fa02c3a8`, `main`, repository `lkpbudibakti-netizen/v22`; working tree awal bersih.

## Audit dan akar masalah

- `docxStyles.formatOfficialDate` mendahulukan kecamatan daripada kabupaten/kota. PDF memakai formatter bersama, sehingga masalah yang sama tampil pada kedua format.
- `snapshot.resolveEffectiveContext` sudah benar: Produksi membangun konteks/snapshot dari identitas aktif, sedangkan Normal mempertahankan snapshot historis. `updateSchoolV5` tidak mengubah kalender/JP/kurikulum. Jalur impor dan annual ZIP sudah membawa sekolah tujuan dan konteks semester masing-masing; tidak perlu ditulis ulang.
- `TimePlanningManager.handleAutoResolve` selalu memulai pencarian regional/AI dan baru memakai nasional sebagai fallback. Tidak ada efek yang otomatis memanggilnya ketika kota berubah; sinkronisasi kalender bergantung pada ID/versi kalender, bukan identitas sekolah. Fungsi publik `calendarResolver.resolveCalendarBySchoolAndSetting` tidak mempunyai pemanggil aplikasi aktif. Resolver Normal tidak diubah.
- `saveSubjectWeeklyScheduleV5` hanya menyimpan pola mingguan, selalu memperbarui versi dari pemanggil, dan tidak menyelaraskan tanggal jadwal tersimpan. Preview/export dapat menemui pola baru dengan tanggal lama.
- Validasi ekspor Produksi membedakan metadata WARNING dari kerusakan referensi, tetapi belum selalu memeriksa baris tanggal terhadap pola mingguan/kalender aktual. Snapshot live saja tidak cukup untuk menjamin waktu konsisten.

## Perubahan

1. Kota TTD mengambil `school.regency.trim()` lebih dahulu, baru kecamatan/desa/default bila kosong. `documentDate` tetap sumber tanggal. Tidak ada input identitas baru.
2. Produksi memakai baseline nasional saat pengguna secara eksplisit menyiapkan kalender baru, tanpa pencarian AI/regional. Kalender tersimpan dengan rentang tanggal tetap dipertahankan, termasuk data regional/manual historis. Baseline diberi label nasional dan `PARTIALLY_RESOLVED`, bukan kalender daerah terverifikasi. Normal tetap pada mekanisme sebelumnya.
3. Opsi runtime Produksi pada fungsi save existing membandingkan ID/urutan/hari/JP sesi dan acuan mingguan. Simpan substansi identik mengembalikan pola lama tanpa satu pun write atau perubahan timestamp.
4. Untuk pola yang berubah dengan jadwal tersimpan, validasi sumber lama lebih dahulu, hitung slot lama/baru melalui resolver existing, lalu pasangkan ordinal slot aktual yang sama. Celah tetap kosong; pertemuan tidak ditambah/dihapus; ID, lineage, isi dan JP tetap. Ketidaksediaan pola lama, kalender belum terkonfirmasi, kapasitas/JP berbeda, duplikasi, atau referensi rusak menolak transaksi.
5. Pola dan `LearningMeetingSchedule` berikut fingerprint waktu disimpan dalam satu `saveStorageV5`, hanya setelah seluruh validasi lolos. Tidak ada skema baru, migrasi, AI, perubahan kalender atau versi kurikulum. Modul Ajar/asesmen/jurnal tetap memakai proyeksi kanonis existing; tidak menulis ulang isi atau snapshot historis.
6. Jadwal yang menyentuh pertemuan terlindungi ditolak dengan ID, alasan proteksi dan kebutuhan persetujuan eksplisit. Ini termasuk rujukan rencana pembelajaran/asesmen yang memang dilindungi mekanisme existing. Tidak ada override persetujuan implisit atau penghapusan data pelaksanaan.
7. Validator ekspor Produksi memeriksa dokumen bertanggal terhadap pola/kalender semester yang relevan, termasuk konteks seluruh semester pada ZIP/PROTA. Tanggal yang stale/tidak dapat diverifikasi memblokir dokumen terdampak; navigasi WARNING bukan kelayakan ekspor. Modul/master tanpa baris tanggal tetap mengikuti kebijakan existing. Jalur Normal tetap memakai validator sebelumnya.

## File/fungsi berubah

- `src/services/documentEngine/docxStyles.ts`: `formatOfficialDate`.
- `src/services/storageV5.ts`: `saveSubjectWeeklyScheduleV5`, opsi runtime saja.
- `src/App.tsx`: `handleSaveSubjectWeeklySchedule`, meneruskan opsi hanya pada Produksi.
- `src/components/administration/TimePlanningManager.tsx`: `handleAutoResolve` dan label tombol/informasi Produksi.
- `src/services/documentEngine/index.ts`: `validateDocumentRequirements`, pemeriksaan waktu aktual sebelum ekspor Produksi individual/ZIP/PDF.
- `scripts/testProductionIdentitySchedule.tsx`: regresi baru.
- `package.json`, `scripts/ci/test-groups.json`: registrasi tes.
- Laporan ini.

Diaudit tanpa perubahan: `SubjectWeeklyScheduleManager`, `subjectScheduleService`, `learningMeetingScheduleService`, `calendarResolver`, `scheduledLearningMeetingProjectionService`, `meetingTimeProjection`, `snapshot`, `annualZipPlan`, renderer PDF dan `administrationProjectImportService`.

## Hasil uji terfokus

Enam kelompok regresi baru PASS, mencakup seluruh sebelas skenario permintaan: perubahan Tangerang→Bandung dan tanggal pengesahan tanpa perubahan data pembelajaran; no-op tanpa write; Senin→Selasa kedua semester; alokasi 108 JP dengan kapasitas berlebih/celah tanpa penambahan pertemuan; kapasitas kurang; realisasi terlindungi; konflik tanpa partial save; impor profil/sekolah lain; konsistensi isi DOCX/PDF; Normal tetap pada alur penyimpanan sebelumnya. Backup/reload, kalender nasional tanpa AI, dan penolakan ekspor tanggal stale ikut diuji.

File benar-benar dihasilkan dan diperiksa: PROTA/PROMES/Alokasi Waktu DOCX/XML dan PDF text untuk dua semester; kota Bandung dan `documentDate` yang sama; Alokasi Waktu memuat tanggal Selasa yang baru. ZIP dokumen menghasilkan 10 file DOCX/PDF (PROTA tahunan, dua PROMES, dua Alokasi Waktu). ZIP proyek dibuka/dipratinjau impor ke sekolah lain dengan 36 pertemuan dipertahankan tanpa mutasi sumber.

Hasil akhir grup CI: storage 24/24 PASS, planning 22/22 PASS, documents 11/11 PASS, transport 5/5 PASS (62 suite). Pemanggilan CI lengkap awal menemukan satu kegagalan Work Modes: status konfirmasi kalender yang memang advisory di Produksi ikut dianggap data waktu rusak. Pemeriksaan ekspor kemudian disesuaikan agar status konfirmasi hanya advisory, sementara hari efektif, slot/JP, duplikasi dan fingerprint tetap diverifikasi tanpa mengubah status tersimpan. Kasus kalender advisory dengan hari aktual tidak efektif tetap ditolak pada regresi baru. Work Modes dan seluruh grup documents dijalankan ulang dan PASS. `npm.cmd run lint` (TypeScript `tsc --noEmit`), build frontend/PWA/server dan `git diff --check` PASS.

## Batas dan risiko

Persetujuan/migrasi tanggal untuk pertemuan terlindungi tidak ditambahkan sebagai UI baru. Kasus tersebut ditolak aman dan perlu peninjauan eksplisit; tidak ada klaim dapat memindahkan realisasi/jurnal/presensi secara otomatis. Pengujian memakai fixture kalender representatif, bukan kalender sekolah nyata atau provider AI live. Word/LibreOffice visual rendering tidak diuji; tes isi DOCX/PDF dan regresi PDF bukan bukti pagination DOCX pada seluruh renderer. Warning ukuran bundle existing tetap perlu dibedakan dari kegagalan build.
