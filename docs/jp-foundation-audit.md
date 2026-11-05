# Audit fondasi JP V20

Base checkout: 750bf039fe6104c1cfba9eb7463143e44a2b79fd. Perubahan lokal, belum commit/push.

## Temuan dan perbaikan

- Lookup JP mengabaikan level/TA pada delegasi awal dan mempunyai fallback fuzzy yang dapat mengambil aturan kelas/mapel lain. Sekarang lookup memakai kurikulum, jenjang, kelas, mapel, TA dan jenis acuan; context tidak cocok tetap tidak terverifikasi. Angka master tidak diubah.
- Metadata acuan aturan 2025 sebelumnya mengambil regulasi pertama (2024). Kini metadata memilih regulasi terbaru dari daftar sumber aturan yang terpilih. URL Permendikdasmen 13/2025 menunjuk PDF resmi yang diperiksa: https://kemendikdasmen.go.id/download/file/1400 . Lampiran II Tabel 1 membedakan PJOK SD I 108 JP intra dan 36 JP koko; Tabel 6 membedakan PJOK SMP VII 72 intra dan 36 koko. Audit ini tidak mengklaim pencocokan literal seluruh 583 baris terhadap seluruh lampiran regulasi.
- Kapasitas semester memaksa kalender parsial menjadi resolved dan tidak menggunakan slot mapel aktual. Helper bersama sekarang memilih slot tanggal mapel yang valid; libur pada tanggal tanpa slot mapel tidak mengurangi JP mapel. Libur/nonpembelajaran yang beririsan slot dikeluarkan satu kali. Bila weekday mapel belum tersedia, estimasi hari efektif tetap dipertahankan dan diberi basis estimasi pada diagnostik. Kalender parsial menghasilkan kapasitas belum diketahui.
- Proyeksi tahunan satu semester x 2 dihapus. Pemeriksaan tahunan mensyaratkan kedua semester. Status alokasi terhadap kapasitas dipisahkan dari pemeriksaan acuan kurikulum, pengurangan JP karena kalender dan sisa JP yang belum dialokasikan. Saldo tahunan seimbang tidak menghapus overflow salah satu semester.
- Override semester tetap diutamakan, termasuk override eksplisit dengan nilai sama dengan acuan; NaN/Infinity ditolak. Resolusi semester memeriksa identitas semester.
- UI tahunan memakai alokasi meeting canonical bila tersedia; legacy time allocation masih didukung. Memo context ekspor ikut diperbarui ketika kalender/jadwal/JP berubah.
- PROMES, PROTA dan Alokasi Waktu tidak lagi mencetak enum/status teknis ke DOCX/PDF. Kalender mencetak label agenda manusiawi untuk status canonical maupun legacy. Ekspor memisahkan angka acuan dari kapasitas kalender. Nilai legacy tersimpan tidak diperbaiki secara otomatis.

Tidak ada perubahan otomatis kalender, angka master regulasi, CP/TP/ATP, Bab, storage schema atau data tersimpan. Tidak ada simulasi redistribusi baru.

## Pengujian

Lulus (5 suite):
- testJPFoundationRegression.ts: lookup scope/type/year, slot terkena/tidak terkena libur, duplikasi tanggal, estimasi tanpa weekday, kalender parsial, override/stale, ketidakseimbangan semester, input immutable dan generasi DOCX/PDF asli untuk PROMES/PROTA/Alokasi Waktu/Kalender tanpa kode status teknis.
- testCalendarJpRegression.ts.
- testCalendarJpIntegrationRegression.ts.
- testPromesDocumentPresentationRegression.ts (dokumen asli dan teks PDF).
- testAnnualAdministrationZipRegression.ts (validator/projection asli, bytes renderer simulasi).

Belum lulus (4 suite legacy; tidak diubah untuk memaksakan hijau):
- testCanonicalPromesProjection.ts dan testCanonicalProtaProjection.ts: fixture hanya mengisi alokasi legacy dan mengharapkan ready tanpa mapping/struktur meeting/jadwal canonical. Eksekusi builder versi HEAD juga mengembalikan not-ready dengan alasan canonical context tidak tersedia.
- testAutoSemesterTimeAllocation.ts: perhitungan kasus 1–15 lulus; gagal pada assertion source string academicSetting.id === autoAllocationReadiness.sem1PlanId. String tersebut juga tidak ada pada source HEAD.
- testCurriculumMaster.ts: integritas matematis 583 rule dan evidence 577 rule VERIFIED lulus; suite berhenti pada assertion CP historical 2024/2025. CP master/resolver tidak diubah.

Build penuh npm run build sudah dicoba dan gagal saat memuat Vite config karena node_modules/magic-string/dist/magic-string.es.mjs hilang. Tidak ada dependency yang di-install/ditambal. Bundle App dan server terpisah melalui esbuild berhasil. Typecheck global masih melaporkan fixture/type existing; pemeriksaan log tidak menemukan error pada modul JP yang diubah saat pemeriksaan tersebut. git diff --check lulus.

PDF memberikan warning optional canvas/font polyfill dan lebar tabel existing; pemeriksaan ini memverifikasi angka/teks dan ketiadaan status teknis, bukan visual QA seluruh halaman.

## Lanjutan

1. Pulihkan dependency build secara terpisah, lalu ulangi build penuh.
2. Migrasikan empat suite legacy yang disebutkan ke contract/fixture canonical saat ini; jangan longgarkan validator untuk membuat test lulus.
3. Lakukan visual QA dokumen dan pencocokan literal seluruh tabel regulasi bila diperlukan sebelum menyatakan seluruh master telah diaudit terhadap sumber resmi.
4. Pola sesi legacy tanpa weekday tetap merupakan estimasi; input tanggal mengajar aktual dibutuhkan untuk kapasitas slot exact. Tidak ada redistribusi JP yang dijalankan.

## File berubah

- src/App.tsx
- src/components/AcademicSettings.tsx
- src/components/AdminDocsExport.tsx
- src/components/AnnualPlanningManager.tsx
- src/components/TeacherTeachingLoadModal.tsx
- src/components/administration/AdministrationHub.tsx
- src/components/administration/TimePlanningManager.tsx
- src/data/curriculum/regulations.ts
- src/services/curriculumRules.ts
- src/services/documentEngine/annualZipPlan.ts
- src/services/documentEngine/generators/alokasiWaktuGenerator.ts
- src/services/documentEngine/generators/kalenderGenerator.ts
- src/services/documentEngine/generators/promesGenerator.ts
- src/services/documentEngine/generators/protaGenerator.ts
- src/services/documentEngine/promesPresentation.ts
- src/services/documentEngine/promesProjection.ts
- src/services/documentEngine/protaProjection.ts
- src/services/documentEngine/renderers/pdf/pdfDocGenerators.ts
- src/services/documentEngine/types.ts
- src/services/jpEngine.ts
- src/services/semesterJPResolver.ts
- src/services/subjectScheduleService.ts
- src/types/jpEngine.ts
- scripts/testJPFoundationRegression.ts
- src/services/annualJPAssessment.ts
- src/services/documentEngine/calendarPresentation.ts
- docs/jp-foundation-audit.md
