# Audit JP V21 — V21-JP-2026-10-31

Checkout: `D:\Repository Github\percobaan 1\Alco-Adm-v21-Penyesuaian-JP-dan-Jadwal`, branch `main`, baseline `3218d9c783231eba4cdd93149b68d12458ee0221`. Baseline bersih. Perubahan belum commit/push.

## Sumber dan metode

- [Permendikdasmen 13/2025, PDF resmi pengundangan](https://peraturan.go.id/filespengundangan/Permendikdasmen-no-13-tahun-2025.pdf), Lampiran II Tabel 1–10 serta keterangannya. Halaman PDF 16–33 (nomor halaman tercetak 9–26). SHA-256 PDF yang diperiksa: `8153c74577d0b7a9f2dfc7f41d3096bc0882d796cc2f26ddea5f6c0d80f44c7a`. Tanggal penetapan 11 Juli, pengundangan/berlaku 15 Juli 2025; metadata registry dikoreksi. Tanggal implementasi TA pada rule tetap dibedakan dari tanggal berlaku hukum.
- [Permendikbudristek 12/2024, salinan JDIH](https://jdih.kemendikdasmen.go.id/sjdih/siperpu/dokumen/salinan/salinan_SALINAN%20PERMENDIKBUDRISTEK%20NOMOR%2012%20TAHUN%202024..pdf), Lampiran II Tabel 1–9 serta keterangannya. Teks tabel tersedia melalui pembacaan web resmi; unduhan langsung URL JDIH gagal pada sesi ini. Tidak mengklaim checksum salinan lokal 2024.
- Angka intra, koko/P5, total, minggu, dan ekuivalen mingguan diperiksa terpisah. Sel agama gabungan berlaku untuk keenam agama, bukan enam alokasi yang dijumlahkan. Cabang Seni/Prakarya adalah pilihan dalam satu kelompok.
- Semua **493 aturan KM** yang ada di tiga file diperiksa: **405 cocok secara angka, 69 dikoreksi, 19 audit manual**. K13 tidak diubah. Tidak ada koreksi angka tanpa nilai eksplisit dalam tabel/keterangan. Minggu referensi 36, atau 32 untuk kelas VI/IX/XII; menit per JP SD/SMP/SMA adalah 35/40/45.
- [Matriks lengkap](jp-regulation-matrix-v21.csv) mencantumkan ID setiap rule, versi, kelas/mapel, sebelum/resmi, rujukan tabel, URL, dan alasan audit manual. Urutan angka: intra/koko/total/minggu/ekuivalen mingguan. `scripts/fixtures/jpRegulationMatrix.json` menyimpan transkripsi pembanding untuk tes. Nilai `null` berarti tidak ada angka cabang/nasional yang dapat disahkan, bukan nol JP.

## Ringkasan perbedaan angka

Semua angka berikut dalam urutan **intra / koko / total tahunan**. Enam agama: PAI, PAK, PKAT, PHINDU, PBUDDHA, PKHONGHUCU.

| Versi dan kelas | Mapel | Master baseline → resmi | Rujukan Lampiran II |
|---|---|---|---|
| 2025 SD I | Bahasa Indonesia | 216/72/288 → 252/36/288 | 13/2025 Tabel 1 |
| 2025 SD II | Bahasa Indonesia | 252/72/324 → 288/36/324 | 13/2025 Tabel 2 |
| 2024 dan 2025 SMP VII–VIII | Enam agama | 108/36/144 → 72/36/108 | 12/2024 Tabel 5; 13/2025 Tabel 6 |
| 2024 dan 2025 SMP IX | Enam agama | 96/32/128 → 64/32/96 | 12/2024 Tabel 6; 13/2025 Tabel 7 |
| 2024 dan 2025 SMA X | Bahasa Inggris | 72/36/108 → 108/0/108 | Tabel 7 (2024), 8 (2025) |
| 2024 dan 2025 SMA X | Informatika | 72/36/108 → 72/0/72 | Tabel 7 (2024), 8 (2025) |
| 2025 SMA X–XI | Pancasila, empat Seni | 54/18/72 → 72/0/72 | 13/2025 Tabel 8–9 |
| 2025 SMA XII | Pancasila, empat Seni | 48/16/64 → 64/0/64 | 13/2025 Tabel 10 |
| 2024 dan 2025 SMA XI | Bahasa Inggris | 108/36/144 → 108/0/108 | Tabel 8 (2024), 9 (2025) |
| 2024 dan 2025 SMA XII | Bahasa Inggris | 96/32/128 → 96/0/96 | Tabel 9 (2024), 10 (2025) |
| 2024 SMA XI | Sejarah | 72/36/108 → 54/18/72 | 12/2024 Tabel 8 |
| 2024 SMA XII | Sejarah | 64/32/96 → 48/16/64 | 12/2024 Tabel 9 |
| 2025 SMA XI | Sejarah | 72/36/108 → 72/0/72 | 13/2025 Tabel 9 |
| 2025 SMA XII | Sejarah | 64/32/96 → 64/0/64 | 13/2025 Tabel 10 |
| 2024 dan 2025 SMA XI | Prakarya/Kewirausahaan | 180/0/180 → 72/0/72 | Keterangan d, Tabel 8 (2024), 9 (2025) |
| 2024 dan 2025 SMA XII | Prakarya/Kewirausahaan | 160/0/160 → 64/0/64 | Keterangan d, Tabel 9 (2024), 10 (2025) |

**Historis dipertahankan:** Bahasa Indonesia SD I–II 2024 tetap 216/72 dan 252/72; Pancasila/Seni SMA 2024 tetap ekuivalen 1,5 JP/minggu dan `ANNUAL`. Koreksi Sejarah historis memakai nilai historis 54/18 atau 48/16, bukan nilai 2025.

## Perubahan file dan pemisahan scope

Data regulasi:

- `src/data/curriculum/structure/sd.ts`, `smp.ts`, `sma.ts`: 69 koreksi angka beserta ekuivalen/catatan; rujukan Lampiran II dan nomor tabel per versi diperbaiki. Evidence 2025 menunjuk tabel 2025, agar perubahan 2025 tidak diklaim didukung angka tabel 2024. Angka 19 rule yang tidak mempunyai dasar nasional tetap dipertahankan dan ditandai `UNVERIFIED`.
- `src/data/curriculum/regulations.ts`: tanggal berlaku hukum 13/2025 menjadi 15 Juli 2025.

Pengamanan kecil pada engine yang sudah ada (bukan penggantian engine):

- `src/data/curriculum/resolver.ts`: tahun ajaran harus dua tahun berurutan; input kapasitas aktual menolak NaN/Infinity/negatif. Tidak memakai ekuivalen resmi untuk menghitung kapasitas tahunan aktual.
- `src/services/semesterJPResolver.ts`: fallback ekuivalen pecahan, termasuk setting tersimpan bersumber `DEFAULT_ANNUAL`, menjadi unresolved hingga ada setting sekolah eksplisit. Referensi 1,5 tetap tersedia; override eksplisit tetap didahulukan. Tidak menyimpan ulang data.
- `src/services/jpEngine.ts`: rule belum terverifikasi tidak lagi diberi `sourceType: OFFICIAL`.
- `src/services/subjectScheduleService.ts`: validasi menolak expectedWeeklyJP non-finite. Pola 1, 2, 3, 3+2, bahkan 10 JP satu sesi tetap lolos bila konsisten dengan setting sekolah. Positif/integer merupakan kontrak satuan slot aplikasi, bukan klaim regulasi minimum/maksimum sesi.
- `scripts/testJPRegulationV21.ts`, fixture matriks, dan `package.json`: tes JP khusus. `scripts/testCurriculumMaster.ts`: assertion Fisika SMA X diperbaiki agar tidak mengesahkan pembagian IPA yang tidak ditetapkan tabel.

UI, CP/TP/ATP, prompt AI, generator dokumen, schema Storage V5, serta mekanisme penyimpanan/migrasi tidak diubah.

## Audit konsistensi kapasitas

- `getSubjectJP` memakai intra sebagai annualJP/default target; koko dan total tersedia sebagai lapisan terpisah. Pilihan allocationType hanya memilih acuan yang diminta, tidak menambahkan koko ke intra.
- `resolveCurriculumContext` memisahkan official annual target dari actualScheduledAnnualJP / actualWeeklyJP × minggu aktual. Override sekolah tidak menulis master.
- `resolveSemesterCapacityV5` dan `resolveCalendarSubjectCapacity` memakai tanggal slot mapel bila weekday tersedia; libur di luar slot tidak mengurangi JP. Kalender parsial unresolved. Pola lama tanpa weekday tetap estimasi, bukan kapasitas tanggal pasti.
- `assessAnnualJP` membandingkan target resmi dengan jumlah alokasi dan kapasitas dua semester: referenceDifferenceJP, capacityBelowReferenceJP, saldo per semester. Saldo tahunan seimbang tidak menyembunyikan overflow salah satu semester. Satu semester tidak dikalikan dua.
- Step 08 `resolveLearningMeetingSchedule` mengambil JP dari slot aktual; pola 3+2 menghasilkan sesi 3 dan 2. Ekuivalen mingguan tidak digunakan sebagai batas maksimum per pertemuan.

## Gap dan batas penutupan

1. **19 rule audit manual:** Bahasa Inggris SD I/II pada kedua versi (4); Coding SD IV (1); tujuh cabang IPA/IPS SMA X pada kedua versi (14). Tabel SMA X menetapkan kelompok IPA 216/108/324 dan IPS 288/144/432. Pembagian cabang, termasuk Sejarah, memerlukan kebijakan sekolah. Nilai cabang lama tidak dihapus/dialihkan. Semua tidak boleh diklaim sebagai angka nasional terverifikasi.
2. Master belum merepresentasikan kelompok IPA/IPS SMA X secara utuh sebagai rule kelompok; beberapa pilihan bahasa/Sejarah Tingkat Lanjut dan varian Prakarya dalam tabel juga belum tersedia sebagai entri tersendiri. Penambahan/pemetaan kode adalah pekerjaan terpisah agar tidak mengubah struktur CP/TP/ATP.
3. Lima rule Coding yang sudah `UNVERIFIED` (SD VI, SMP VIII/IX, SMA XI/XII) tetap konservatif. Angka cocok dengan tabel, tetapi catatan lama tentang implementasi bertahap per kelas/TA belum diselesaikan. Tidak ada promosi status diam-diam. TA yang diuji untuk pemilihan rule adalah 2024/2025, 2025/2026, dan agama SMP juga 2026/2027; tidak mengklaim seluruh kombinasi kebijakan penerapan sekolah pada setiap tahun.
4. Pola tahunan blok/berselang dengan 54 JP pada 36 minggu tidak dibuatkan engine rotasi baru. Guru perlu menetapkan pola sekolah; tes membuktikan 27 minggu × 2 JP dapat dimodelkan dengan slot integer, sementara fallback 1,5 tidak dipaksa menjadi sesi.
5. `assessAnnualJP` belum menyediakan tiga total terpisah untuk nominal rencana, alokasi legacy, dan penempatan aktual sekaligus. Pemilihan canonical schedule diprioritaskan oleh `sumSemesterAllocatedJP`; fallback legacy tetap didukung. Penambahan tiga indikator end-to-end/penandaan review UI berada pada perubahan engine/workflow lebih besar, tidak dicampurkan ke koreksi data ini.
6. Nilai annual reference yang sudah tersimpan mungkin masih memakai master lama. Tidak ada migrasi, penimpaan, redistribusi, atau reset jadwal otomatis. Konsumen yang memakai lookup master kini mendapat koreksi; konsumen yang memakai snapshot tersimpan memerlukan review eksplisit. Tidak ada bukti visual UI/browser atau pengujian terhadap data pengguna nyata.

## Dampak JP rencana dan jadwal aktual

- PAI SMP VII TA 2025/2026: target intra turun 108 → **72**, koko tetap **36**, total turun 144 → **108**; ekuivalen intra 3 → **2**. Semua agama VII/VIII mengalami dampak sama; IX 96 → 64 intra.
- Jadwal sekolah 3 JP/minggu yang sudah tersimpan tetap 3; pada 36 minggu tanpa libur kapasitas 108 dibanding target 72 menunjukkan surplus 36. Override 2 pada 32 minggu menghasilkan kapasitas 64 dan selisih kurang 8 terhadap target 72. Angka target resmi tidak diturunkan mengikuti libur/minggu efektif.
- Matematika SD 5 JP/minggu dapat dialokasikan 3+2; PJOK SD tetap 3 JP/minggu. Libur pada sesi 3 JP mengurangi 3, bukan persentase minggu atau seluruh JP mingguan. Tidak ada otomatisasi yang memotong sesi agar sama dengan ekuivalen regulasi.
- Perubahan Pancasila/Seni SMA 2025 memindahkan JP dari koko ke intra tanpa mengubah total; jadwal 1,5 legacy tidak disahkan ulang menjadi 2 secara otomatis.

## Verifikasi

Lulus:

- `npm.cmd run test:jp-regulation-v21`: 493 rule, scope/tahun pemilihan, enam agama, PJOK 3, Matematika 3+2, kalender 32–36 minggu dan blok 27 minggu, libur slot/non-slot, kalender parsial, 1/10 JP sesi, fractional annual fallback, override semester/V5 immutable, Step 08 durasi slot, selisih tahunan.
- `tsx scripts/testJPFoundationRegression.ts`: lookup, kapasitas/override, immutable, dan tes DOCX/PDF existing; generator tidak diubah. Ada warning lebar tabel existing; bukan visual QA dokumen.
- `tsx scripts/testCalendarJpRegression.ts`.
- `tsx scripts/testCalendarJpIntegrationRegression.ts`: termasuk save JP/time allocation tidak menghapus kalender Storage V5.
- `tsx scripts/testStep7Step8LineageRegression.ts`.
- `npm.cmd run test:workflow`.
- `npm.cmd run build`: frontend Vite, PWA, dan server esbuild; warning ukuran bundle >500 kB.
- Pembandingan objek dengan `git show HEAD`: tepat 69 koreksi angka, 18 perubahan status (satu gap memang sudah UNVERIFIED), seluruh objek K13 identik, dan seluruh kolom before pada matriks sama dengan commit baseline.

Belum hijau:

- `npm.cmd run test:curriculum`: bagian JP lolos setelah assertion Fisika diperbaiki; berhenti pada assertion sumber CP historis 2024/2025 (`DEC-BSKAP-032-2024`). CP master/resolver tidak diubah dan masalah itu berada di luar scope audit JP.
- `npm.cmd run lint`: 67 diagnostic TypeScript pada fixture lain; tidak ada diagnostic yang menunjuk file JP yang diubah atau tes JP baru. Tidak diklaim typecheck global lulus.

Dependensi dipasang lokal dengan `npm.cmd install --no-package-lock --no-audit --no-fund` karena checkout tidak memiliki package-lock (memiliki bun.lock). Manifest/lock dependency tidak diubah. Build memakai versi hasil resolusi instalasi ini, bukan instalasi frozen bun.lock.

Keputusan: koreksi data terbukti dapat direview terpisah. Fondasi master untuk 474 rule bernilai eksplisit telah dibandingkan; 19 rule dan gap representasi/penerapan di atas mencegah klaim seluruh fondasi regulasi/engine tertutup sempurna.
