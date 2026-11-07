# Audit generator administrasi guru DOCX PDF v22

Tanggal pengujian: 7 November 2026 (Asia/Jakarta).

## Finalisasi ulang pada main

Status akhir audit ulang: BLOCKED untuk sertifikasi siap cetak DOCX dan kesetaraan visual DOCX/PDF. PASS pada struktur dokumen, bidang substansi yang diuji, serta pemeriksaan PDF yang disebutkan di bawah. Ini tidak berarti seluruh hasil cetak sudah tersertifikasi.

Temuan baru dan perbaikan minimal:

- 124 berkas sementara di tmp/print-audit ternyata masuk Git meskipun aturan ignore sudah ada. Seluruhnya dikeluarkan dari indeks. .gitignore dan skrip pengujian di scripts/ dipertahankan; hasil regenerasi tetap diabaikan Git.
- Promes DOCX merujuk “lihat rincian”, tetapi generator tidak menambahkan presentation.details dan promesAnnualJPNotes. Perbandingan teks aktual DOCX/PDF membuktikan TP panjang dan catatan JP hilang di DOCX. promesGenerator.ts kini memasukkan kedua keluaran bersama tersebut, sama dengan PDF. Tes sebelumnya hanya memeriksa rincian pada model presentasi; regresi baru memeriksa teks serialisasi DOCX dan ekstraksi PDF secara utuh, dengan footer pagination PDF dikecualikan.
- Header “No” terbungkus menjadi dua huruf pada sampel PDF. Padding header diperkecil di pdfRenderer.ts. Regresi memeriksa token No utuh pada header Promes. Test print-layout juga dimasukkan ke grup CI documents agar pemeriksaan isi berkas berjalan otomatis.
- Prota dengan TP panjang meninggalkan header tabel sendirian pada halaman pertama karena seluruh baris ditahan. Opsi pemisahan baris hanya pada tabel Prota dibuat auto, sesuai alur tabel DOCX; default jenis lain tetap avoid. Proteksi TTD tidak diubah. Regresi memastikan Bab 1 mulai pada halaman pertama. Sampel ekstrem turun dari 4 menjadi 3 halaman PDF, tanpa mengurangi isi.

Renderer dan batas validasi:

- LibreOffice soffice.exe tidak tersedia. Sebanyak 24 DOCX (19 jenis + 3 sampel data + 2 stress) dicoba ulang; seluruhnya RENDER_BLOCKED.
- Registrasi Word.Application memang ada dan memberi versi 12.0, tetapi LocalServer32 mengarah ke Kingsoft WPS wps.exe /Automation. Ini bukan Microsoft Word dan tidak dihitung sebagai validasi Word. Tidak memasang atau mengganti aplikasi pengguna.
- A4 dan margin dari XML lulus: ATP/Prota 11906 × 16838 twip portrait; Promes 16838 × 11906 landscape. Pagination, font substitusi, tabel, header, dan TTD pada render DOCX serta kesetaraan visualnya dengan PDF tetap BLOCKED.
- Sampel ATP, Prota, Promes: identitas guru/kepala sekolah/NIP, TP dan angka JP yang diperiksa ditemukan pada kedua format. Rincian lengkap Promes dan catatan tahunan kini diperiksa oleh regresi yang tersimpan di repo. Ini pemeriksaan substansi, bukan bukti kesamaan visual seluruh dokumen.
- PDF akhir: 57 halaman dari 24 sampel dirasterisasi. Halaman representatif ATP, Promes, Prota, termasuk identitas panjang dan TTD, diperiksa dari PNG. Tidak ditemukan potongan teks/TTD pada sampel yang ditinjau. ATP 2 halaman portrait; Promes 4 halaman landscape; Prota 3 halaman portrait. TTD lengkap dan memiliki konteks judul/sekolah/mapel/kelas/tahun. Pemeriksaan batas teks otomatis tetap bersifat pendekatan seperti dijelaskan di bawah.

Pengujian ulang: print-layout 19 jenis dan kasus panjang; Promes presentation; orientation/fidelity/ZIP; asesmen 27 kasus; seluruh grup CI (storage 22, planning 7, documents 8, transport 5); TypeScript; build; production smoke 15 kasus. Hasil akhir seluruh pemeriksaan otomatis tersebut PASS. Build masih memberi peringatan ukuran bundle. Tidak ada perubahan data kurikulum, data guru, alokasi, lineage, penyimpanan, atau arsitektur aplikasi.

Risiko tersisa: renderer Microsoft Word/LibreOffice wajib tersedia untuk memverifikasi seluruh pagination dan margin visual DOCX; jumlah halaman DOCX belum diketahui. PDF dan DOCX masih renderer terpisah, sehingga kesetaraan visual penuh tidak dapat disimpulkan dari XML/ekstraksi teks. Template kalender DOCX masih memuat ringkasan tambahan dibanding PDF. Tidak menyatakan semua dokumen siap cetak.

## Rincian audit awal dan inventaris



Status: PERBAIKAN IMPLEMENTASI DAN REGRESI LULUS; SERTIFIKASI SELURUH DOKUMEN SIAP CETAK BELUM TERBUKTI.

## Akar masalah dan batas pembuktian

- Akar portrait DOCX ditemukan dan direproduksi dari XML: helper landscape memasukkan ukuran yang sudah ditukar (16838 × 11906 twip), sedangkan pustaka docx menukarnya lagi ketika orientasi LANDSCAPE. Hasil lama adalah w:w=11906, w:h=16838 walaupun w:orient=landscape. Helper kini memasukkan ukuran dasar A4 11906 × 16838 sehingga hasil serialisasi landscape benar-benar 16838 × 11906. Ini memengaruhi Promes dan semua generator landscape. Tes lama hanya memeriksa label orientasi; regresi baru memeriksa dimensi numerik. Berkas pengguna asli 12 halaman tidak tersedia sehingga jumlah halaman aslinya tidak direproduksi.
- Matriks memasukkan seluruh pernyataan TP dan materi ke sel sempit. Dengan banyak kolom bulan, isi memanjang dan baris boleh dipecah antarhalaman.
- TTD DOCX memiliki implementasi terpisah pada helper umum, Modul Ajar, asesmen, dan ATP lama. Baris TTD tidak memiliki cantSplit; spacer kosong memakai tinggi/spasi tetap. PDF mempunyai dua implementasi dengan perkiraan tinggi 40/42 mm, tanpa pembungkusan nama/NIP.
- PDF memakai judul satu baris dan kolom tabel berlebar tetap. Sebagian judul melewati margin. Asesmen memakai bobot kolom berjumlah 100 seolah milimeter, menyisakan 55 mm dan memunculkan peringatan autoTable.
- Prota menampilkan selisih acuan dengan tanda negatif tanpa arah yang jelas. Promes menyebut kapasitas kalender sebagai alokasi semester, sehingga dapat dibaca sebagai acuan regulasi.
- HARI_EFEKTIF didukung PDF tetapi tidak mempunyai cabang DOCX pada dispatcher. Kini memakai generator kalender bersama dengan identitas jenis/judul/nama berkas sendiri.

## Jalur ekspor dan komponen bersama

`AdminDocsExport`, tombol ekspor pada manager administrasi, dan `zipBundle.ts`/`annualZipPlan.ts` mengarah ke `documentEngine/index.ts`. DOCX memakai generator per jenis dan Packer; PDF langsung memakai `renderers/pdf/pdfDocGenerators.ts` serta PdfDocumentBuilder, bukan konversi DOCX. Asesmen melalui assessmentExportService dan model normalisasi yang sama; proyeksi COMPLETE, STUDENT_INSTRUMENT, SCORING_GUIDE diaudit pada sumber. STUDENT_INSTRUMENT memang tidak memiliki TTD; dua proyeksi lainnya menggunakan helper yang sama. ATP lama `src/services/docxGenerator.ts` juga diperbaiki. Folder donor pack adalah salinan referensi, bukan jalur aplikasi aktif; tidak diubah.

Komponen yang sudah tersedia: docxStyles (A4, margin, metadata, header, sel tabel, TTD), PdfDocumentBuilder, proyeksi ATP/Prota/Promes, promesPresentation, snapshot dan validasi lineage. Perubahan mengutamakan komponen ini; tidak menambah dependensi produksi.

## Perubahan

- `signoffLayout.ts`: satu model identitas dan helper DOCX untuk semua pemilik TTD. Tabel dua kolom tetap berada dalam alur dokumen, satu baris cantSplit, paragraf keepLines/keepNext, caption konteks keepNext ke tabel. Ruang tanda tangan berupa tiga line break mengikuti font, tanpa posisi absolut atau tinggi baris tetap. Nama dan NIP tidak dipotong.
- Seluruh generator meneruskan konteks judul, mapel, kelas, tahun, dan sekolah. Asesmen juga meneruskan metadata model normalisasinya. Halaman lanjutan pengesahan memiliki konteks tersebut; halaman khusus pengesahan masih dapat terjadi ketika ruang tidak cukup, tetapi bukan TTD tanpa identitas dokumen.
- PDF menghitung tinggi dari pembungkusan tanggal, jabatan, nama dan NIP menurut lebar dua kolom dan ukuran font. Kedua API TTD menggunakan implementasi yang sama. Blok yang tidak muat pindah utuh; identitas yang melampaui satu halaman ditolak secara eksplisit.
- PDF membungkus judul/subjudul dan heading; pusat judul mengikuti area cetak. Margin top/bottom dipakai pada halaman tabel lanjutan. Header tabel berulang dan baris dihindarkan dari split bila muat satu halaman. Kolom yang seluruh lebarnya eksplisit dinormalisasi ke lebar area cetak; padding kolom sempit dikurangi.
- Promes tetap A4 landscape. Proporsi Unit/TP/Materi menjadi 13/18/20 persen. TP/materi >180 karakter memakai rujukan Rn pada matriks; teks lengkap dipertahankan di rincian setelah tabel. Kode yang sangat panjang dipindahkan ke rincian dengan rujukan yang tetap mengikat ke baris. K13 mempertahankan KD dan rincian indikator/materi. Baris matriks DOCX tidak dipecah, header diulang, ukuran teks tabel tetap 10 pt.
- Margin DOCX/PDF diselaraskan: portrait kiri 30 mm, kanan/atas/bawah 25 mm; landscape kiri 25 mm, kanan/atas/bawah 20 mm (DOCX dibulatkan ke twip). Modul Ajar, asesmen, ATP lama kini memakai pengaturan A4 eksplisit bersama.
- `jpPresentation.ts` membedakan kapasitas kalender tahunan, alokasi aktual guru, acuan regulasi tahunan. Contoh 344 vs 288: “Alokasi aktual melebihi acuan regulasi sebesar 56 JP (344 > 288 JP).” Bila sama, tidak ada catatan selisih regulasi. Bila kurang, arah “di bawah” ditampilkan. Data tahunan yang tidak lengkap dinyatakan belum terverifikasi; acuan tahunan tidak dibagi antarsemester. Angka tidak diubah. Catatan regulasi ini mengikuti proyeksi Merdeka; aturan/alokasi K13 tidak direinterpretasi.
- Promes menyebut KAPASITAS KALENDER SEMESTER dan SISA / DEFISIT KAPASITAS. Selisih ini terpisah dari selisih regulasi tahunan.

## Inventaris dan hasil per jenis

Semua baris tabel berikut berhasil menghasilkan DOCX dan PDF. Kolom halaman adalah PDF langsung pada fixture, bukan jumlah halaman DOCX. Semua TTD DOCX lulus pemeriksaan struktur cantSplit, keepNext, keepLines, tanpa trHeight; ukuran A4 dan margin diperiksa dari XML. Seluruh render DOCX berstatus TERHALANG, bukan valid visual.


| Jenis | Generator DOCX | Orientasi A4 | Mode fixture | Halaman PDF | Batas teks PDF |
|---|---|---|---|---:|---|
| CP | cpGenerator | Portrait | blank | 2 | Lulus |
| TP | tpGenerator | Portrait | blank | 2 | Lulus |
| ANALISIS_CP_TP | analisisCpTpGenerator | Portrait | blank | 2 | Lulus |
| ATP | atpGenerator | Portrait | blank | 2 | Lulus |
| PEMETAAN_ATP_UNIT | pemetaanAtpUnitGenerator | Landscape | blank | 2 | Lulus |
| PROTA | protaGenerator | Portrait | blank | 2 | Lulus |
| PROMES | promesGenerator | Landscape | blank | 3 | Lulus |
| MODUL_AJAR | modulAjarGenerator | Portrait | blank | 2 | Lulus |
| KKTP | kktpGenerator | Portrait | blank | 2 | Lulus |
| DAFTAR_HADIR | daftarHadirGenerator | Landscape | blank | 3 | Lulus |
| ASESMEN | assessmentGenerator → assessmentExportService | Portrait | blank | 1 | Lulus |
| DAFTAR_NILAI | daftarNilaiGenerator | Landscape | blank | 3 | Lulus |
| JURNAL | jurnalGenerator | Landscape | blank | 2 | Lulus |
| REMEDIAL_PENGAYAAN | remedialPengayaanGenerator | Portrait | blank | 2 | Lulus |
| KALENDER_AKADEMIK | kalenderGenerator | Portrait | blank | 2 | Lulus |
| HARI_EFEKTIF | kalenderGenerator (jenis HARI_EFEKTIF) | Portrait | blank | 2 | Lulus |
| ALOKASI_WAKTU | alokasiWaktuGenerator | Portrait | blank | 2 | Lulus |
| ANALISIS_SKL_KI_KD | k13Generator | Portrait | blank | 2 | Lulus |
| PENETAPAN_KKM | k13Generator | Portrait | data | 1 | Lulus |

Sampel data dengan nama/NIP panjang: ATP 2 halaman portrait, Prota 4 halaman portrait, Promes 4 Bab 4 halaman landscape (termasuk rincian TP lengkap). Stress tabel 75 baris dan TTD dipaksa dekat batas akhir: portrait 4 halaman dan landscape 5 halaman. TTD lengkap pada satu halaman pada sampel PDF. Masukan dibandingkan sebelum/sesudah untuk memastikan generator tidak memutasi data guru/kurikulum.

## Pengujian dan bukti

- `npm run test:print-layout`: 19 jenis, 3 sampel data ATP/Prota/Promes, 2 stress; orientasi/ukuran A4/margin DOCX, proteksi TTD, tidak ada tinggi row TTD tetap, bounding box teks PDF, tidak ada halaman tanpa teks, konsistensi total per Bab/bulan/semester, TP rinci tetap utuh, 344/288/56 dan nilai sama/kurang, input tidak berubah.
- `testPromesDocumentPresentationRegression.ts`: dua semester, K13/Merdeka, bulan dan pekan sparse, isi/metadata DOCX-PDF, total dan isolasi semester, mode kosong.
- `testDocumentOrientationAndFidelityRegression.ts`: orientasi ATP/Promes, isi/metadata, tabel panjang, identitas impor, ZIP dua semester. Assertion label lama disesuaikan dengan istilah kapasitas kalender.
- `testJPFoundationRegression.ts`: kapasitas kalender vs acuan resmi, isolasi semester dan sumber aktual; lulus.
- `testCanonicalAlokasiWaktuDocument.ts`: 14 kasus proyeksi kanonis dan 6 kasus K13; lulus.
- `testAuditNo9C8DocumentExportRegression.ts`: 27 kasus kontrak ekspor asesmen; lulus. Peringatan lebar tabel asesmen 55 mm telah hilang setelah normalisasi lebar.
- `npm run lint` (TypeScript): lulus. `npm run build`: lulus, peringatan ukuran bundle >500 kB tetap ada.
- PDF langsung: 58 halaman dari 24 sampel dirasterisasi dengan Poppler; seluruh lembar kontak ditinjau. Tidak ditemukan clipping atau tumpang tindih yang terlihat pada tinjauan tersebut. Gambar penuh juga disimpan untuk pemeriksaan lebih rinci; tinjauan kontak tidak menggantikan pemeriksaan tipografi 100% setiap halaman.
- Render DOCX: 24 berkas dicoba melalui render_docx.py, seluruhnya gagal karena `LibreOffice soffice.exe was not found on PATH`. Tidak memasang dependensi besar atau mengubah mesin pengguna untuk melewati kendala ini.

Bukti lokal yang dapat dibuat ulang berada di `tmp/print-audit/`: pasangan DOCX/PDF, `results.json`, `docx-render-results.json`, PNG halaman, JPG lembar kontak. Berkas QA tidak dikomit. Regenerasi: `npm run test:print-layout`, lalu jalankan `scripts/renderPrintAudit.py` memakai Python yang memiliki pdf2image/Pillow dan Poppler. Parameter `--docx-renderer <path-render_docx.py>` mencoba render setiap DOCX serta mencatat status per berkas. Skrip tidak menetapkan dokumen otomatis siap cetak.

## Keterbatasan dan pemeriksaan yang masih diperlukan

1. Pagination DOCX, TTD utuh pada render Word/LibreOffice, kesetaraan visual DOCX/PDF, dan clipping DOCX BELUM TERBUKTI. XML yang benar bukan bukti hasil cetak Word.
2. Dokumen aktual portrait 12 halaman dan data guru 344 JP/288 JP tidak tersedia sebagai berkas uji asli. Kasus angka tersebut diuji pada formatter murni; integrasi memakai fixture kanonis, bukan data pribadi pengguna.
3. Mayoritas jenis menggunakan fixture mode kosong. ATP/Prota/Promes memakai data; KKM memakai data minimal karena generator lama menolak KKM kosong. Tidak mengklaim seluruh kombinasi isi instrumen, panjang teks, data siswa, atau printer telah diuji.
4. Tabel Prota dengan TP ekstrem dapat meninggalkan ruang besar pada halaman awal karena baris tidak dipisah. Promes dapat meneruskan baris ringkasan ke halaman berikutnya. Ini tidak memotong data, tetapi optimasi kepadatan halaman lebih lanjut belum disertifikasi. Halaman pengesahan tersendiri tetap mungkin, dengan konteks judul/sekolah/mapel/kelas/tahun.
5. Pemeriksaan bounding box PDF memeriksa lebar teks terhadap margin dan batas vertikal halaman secara pendekatan; tidak membuktikan setiap garis tabel, glyph, atau jarak margin vertikal hingga presisi tipografi. Tinjauan raster dan struktur melengkapi, tidak menghapus keterbatasan tersebut.
6. DOCX dan PDF tetap renderer independen. Uji kesamaan substansi terfokus membuktikan ATP/Promes dan model asesmen; kesamaan seluruh isi semua jenis pada data nyata belum dibuktikan. Template kalender DOCX memuat ringkasan efektif tambahan dibanding tabel PDF. Tidak mengklaim kesetaraan keseluruhan yang belum diuji.
7. Jalur ATP lama memakai helper baru, tetapi pengunduhan browser lama tidak dieksekusi dalam pengujian Node. Folder donor tidak termasuk runtime aktif.

Kesimpulan kelayakan: perubahan dapat ditinjau dan diuji ulang; status keseluruhan tetap PARTIALLY VERIFIED sampai render DOCX dan sampel aktual diverifikasi. Tidak menyatakan semua dokumen langsung siap cetak tanpa bukti.
