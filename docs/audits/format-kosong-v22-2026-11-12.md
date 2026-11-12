# Audit Format Kosong — V22

Tanggal: 12 November 2026. Branch: main. Baseline: 58de1de5a32e32060e13d2a85cc0b3bd90ad5326.

## Kesimpulan

Format Kosong sekarang memakai substansi dan persyaratan kesiapan yang sama dengan Dokumen dari Data. Satu salinan konteks khusus ekspor menyamarkan identitas setelah resolusi snapshot. Data V5, snapshot historis, sumber kanonikal, dan validator Step 07/08 tidak diubah.

Status fungsi ekspor: PASS pada fixture representatif. Status visual PDF: PASS pada 44 halaman sampel. Status pagination DOCX di Word/LibreOffice: **BLOCKED**, sehingga audit ini tidak menyatakan semua DOCX sudah terbukti siap cetak.

## Akar masalah berdasarkan baseline

Referensi baris bagian ini adalah commit baseline, bukan nomor setelah perubahan.

- `src/services/documentEngine/index.ts:295,356`: mode blank melewati tanggal dan mengembalikan keberhasilan validasi tanpa substansi lengkap.
- `src/services/documentEngine/atpDocumentProjection.ts:22`, `protaProjection.ts:66,297`, `modulAjarProjection.ts:57`: proyeksi blank dinyatakan siap tetapi mengosongkan isi.
- `src/services/documentEngine/assessmentExportService.ts:407-470,564`: BLANK_TEMPLATE menyalin identitas tetapi mengosongkan paket/instrumen. Cabang sejenis terdapat di generator DOCX dan renderer PDF.
- `src/services/documentEngine/snapshot.ts:119`: fallback `snapshot.schoolName || context.school.name` dan padanannya menghidupkan kembali identitas yang sengaja kosong.
- `src/services/documentEngine/zipBundle.ts:343`: antrean blank terpisah hanya satu dokumen per jenis/semester aktif, berbeda dari perencana ZIP tahunan dan multi-instance.
- `src/components/AdminDocsExport.tsx:216,456,1475`: kelayakan bulk blank dilewati, snapshot bulk dibentuk sendiri dengan identitas asli, preview kosong, dan ekspor blank dapat mengganti rekaman dokumen yang sama.
- `docxStyles.ts`/signoff: flag blank menyembunyikan sebagian nama, tetapi belum menyamarkan konteks identitas secara menyeluruh sebelum header, lokasi/tanggal, dan pengesahan dirender.

## Perbaikan

- `exportIdentity.ts:maskExportIdentity`: satu helper export-only, immutable dan idempotent; menyamarkan profil/sekolah, alias identitas snapshot, sumber identitas kepala sekolah, dan lokasi pengesahan. Tanggal serta kelas/fase/mapel/semester/tahun ajaran dipertahankan. Identitas siswa dan konten administrasi tidak dihapus.
- `snapshot.ts:resolveEffectiveContext/createDocumentSnapshot`: resolusi snapshot terlebih dahulu, lalu mask. Nullish fallback mempertahankan nilai kosong yang disengaja. Snapshot sumber/historis tetap utuh.
- `index.ts:validateDocumentRequirements`, seluruh proyeksi dan generator: hapus jalur template/substansi kosong dan bypass kesiapan. Snapshot asesmen BLANK_TEMPLATE lama yang tidak berisi substansi dilaporkan belum layak, bukan dipromosikan menjadi dokumen lengkap.
- PDF dan DOCX memakai isi proyeksi yang sama pada kedua mode. Generator langsung dan helper pengesahan juga melewati batas konteks aman. Aturan TTD in-flow keep-next/keep-lines/cant-split yang sudah ada dipertahankan; tidak ditambah posisi absolut atau tinggi kosong tetap.
- ZIP memakai perencana tahunan yang sama, semester 1/2 dan instance modul/paket tetap terpisah. Root/nama/path blank memakai identitas generik dan suffix Format_Kosong.
- UI memakai konteks aman untuk preview dan ekspor tunggal/massal. Ekspor blank tidak mengganti rekaman/snapshot data yang ada. Teks diperbarui menjadi “Format Kosong — isi administrasi lengkap, tanpa identitas guru dan sekolah.” Dokumen belum siap tetap dilaporkan.

## Pengujian nyata dan batas bukti

- Final CI: storage 23/23, planning 19/19, documents 9/9, transport 5/5: **56/56 PASS**. Pemanggilan awal seluruh CI menemukan fixture K13 lama tanpa tanggal; fixture diperbaiki dan seluruh kelompok documents dijalankan ulang sampai exit 0. Hasil akhir setiap kelompok tidak memiliki exitCode nonzero.
- Tambahan: Snapshot, AssessmentExport9C8, JurnalMeeting, DocumentOrientationAndFidelity, ModulAjarPresentation, Regulatory2026 **PASS**. Regulatory2026 90/90. ModulAjarPresentation dijalankan ulang tersendiri setelah memperbaiki ekspektasi fixture usang; log final `presentation-final.log` berhasil. Tidak ada pelonggaran validator untuk menyesuaikan fixture.
- `npm.cmd run lint` (**tsc --noEmit**): PASS. `npm.cmd run build`: PASS, frontend dan server; peringatan ukuran chunk yang sudah ada tetap muncul.
- `testBlankIdentityExport.ts`: **39 pasangan kasus**, seluruh 19 jenis dokumen, kedua semester jika relevan dan variasi K13. Berkas DOCX dibuka sebagai ZIP dan seluruh XML/relationships/properties/header/footer dipindai identitas unik; substansi body dibandingkan dengan mode data. PDF dibaca teks/metadata/XMP/geometri dan dibandingkan kontrol tanpa identitas. Bukan pengujian ukuran blob saja.
- ZIP aktual **64 berkas (32 DOCX + 32 PDF)** dibuka dan diperiksa: cakupan/status sama dengan data, termasuk instance modul/paket lintas semester. Nama file/path/root tidak memuat identitas fixture.
- Sumber dan snapshot sebelum/sesudah dibandingkan; tidak berubah. Ekspor tidak menulis V5/snapshot historis. Append diagnostik existing diperiksa terpisah dan tidak memuat identitas unik.
- Handler UI ekspor tunggal dan semua DOCX/PDF diuji dengan generator nyata; unduhan ditangkap pada batas browser. Tidak ada pembaruan rekaman dokumen untuk mode blank. Browser interaktif tidak diuji live.
- Seluruh **44 halaman PDF** diraster dan ditinjau pada contact sheet; ATP portrait, Promes landscape, Prota serta detail modul/asesmen ditinjau. Tidak ditemukan halaman kosong, clipping, identitas bocor, atau blok pengesahan terpotong pada sampel. Pengujian bounds menghasilkan nol pelanggaran.
- DOCX: A4/margin serta XML keep-next/keep-lines/cant-split dan kesetaraan isi PASS. **Render Word/LibreOffice BLOCKED**: LibreOffice tidak tersedia; alias COM Word diarahkan ke WPS, sedangkan native Word 2013 terverifikasi tidak dapat dipakai dengan aman (RPC_E_CALL_REJECTED/attachment proses milik pengujian gagal). Hasil WPS tidak dihitung sebagai bukti Word. Tidak mengubah registrasi Office atau mengklaim pagination Word berhasil.
- Skrip opsional `renderBlankIdentityAudit.ps1` dan `validateBlankWordRender.mjs` menyediakan langkah render native read-only dan pemeriksaan hasil; pada mesin ini status tetap BLOCKED. Pemeriksaan teks/geometri otomatis saja tidak menggantikan tinjauan visual DOCX.

Jenis yang diuji: CP, TP, ANALISIS_CP_TP, ATP, PEMETAAN_ATP_UNIT, PROTA, PROMES, ALOKASI_WAKTU, HARI_EFEKTIF, KALENDER_AKADEMIK, MODUL_AJAR, ASESMEN, KKTP, JURNAL, DAFTAR_HADIR, DAFTAR_NILAI, REMEDIAL_PENGAYAAN, ANALISIS_SKL_KI_KD, PENETAPAN_KKM.

Reproduksi: `npm.cmd run test:blank-export`; `npm.cmd run ci:tests -- all`; `npm.cmd run lint`; `npm.cmd run build`. Artefak QA berada di `tmp/blank-export-audit/`, log CI di `artifacts/ci/`; keduanya tidak dilacak Git. Jika Microsoft Word native dapat diotomasi: jalankan `scripts/renderBlankIdentityAudit.ps1`, lalu `node scripts/validateBlankWordRender.mjs --raster` (argumen pertama validator dapat berupa direktori audit; gunakan `node scripts/validateBlankWordRender.mjs tmp/blank-export-audit --raster`). Tetap tinjau raster sebelum menyatakan lulus visual.

## Risiko tersisa

Pagination DOCX di renderer native belum terbukti. Layout sangat panjang/berbeda font atau versi Office masih memerlukan render native. Fixture identitas unik mendeteksi kebocoran field terstruktur pada jalur yang diuji; helper sengaja tidak menghapus nama yang diketik bebas dalam isi kurikulum/konten guru karena itu akan mengubah substansi. Tidak ada jaminan redaksi bebas yang sudah mengandung identitas akan dianonimkan otomatis. Tidak ada perubahan CP/TP/ATP, Step 07/08, arsitektur penyimpanan, atau dependency runtime.

## File berubah
- `docs/audits/format-kosong-v22-2026-11-12.md`
- `package.json`
- `scripts/ci/test-groups.json`
- `scripts/fixtures/identityExportFixture.ts`
- `scripts/helpers/v21TimeProjectionContract.ts`
- `scripts/renderBlankIdentityAudit.ps1`
- `scripts/testAudit2026RegulatoryCompatibility.ts`
- `scripts/testAuditNo9C8DocumentExportRegression.ts`
- `scripts/testBlankIdentityExport.ts`
- `scripts/testCanonicalAlokasiWaktuDocument.ts`
- `scripts/testJurnalMeetingRegression.tsx`
- `scripts/testModulAjarPresentationRegression.ts`
- `scripts/testPrintLayoutRegression.ts`
- `scripts/validateBlankWordRender.mjs`
- `src/components/AdminDocsExport.tsx`
- `src/components/JournalRealizationEditor.tsx`
- `src/components/ZipExportModal.tsx`
- `src/services/documentEngine/annualZipPlan.ts`
- `src/services/documentEngine/assessmentExportService.ts`
- `src/services/documentEngine/atpDocumentProjection.ts`
- `src/services/documentEngine/docxStyles.ts`
- `src/services/documentEngine/exportIdentity.ts`
- `src/services/documentEngine/generators/alokasiWaktuGenerator.ts`
- `src/services/documentEngine/generators/analisisCpTpGenerator.ts`
- `src/services/documentEngine/generators/assessmentGenerator.ts`
- `src/services/documentEngine/generators/atpGenerator.ts`
- `src/services/documentEngine/generators/cpGenerator.ts`
- `src/services/documentEngine/generators/daftarHadirGenerator.ts`
- `src/services/documentEngine/generators/daftarNilaiGenerator.ts`
- `src/services/documentEngine/generators/jurnalGenerator.ts`
- `src/services/documentEngine/generators/k13Generator.ts`
- `src/services/documentEngine/generators/kalenderGenerator.ts`
- `src/services/documentEngine/generators/kktpGenerator.ts`
- `src/services/documentEngine/generators/modulAjarGenerator.ts`
- `src/services/documentEngine/generators/pemetaanAtpUnitGenerator.ts`
- `src/services/documentEngine/generators/promesGenerator.ts`
- `src/services/documentEngine/generators/protaGenerator.ts`
- `src/services/documentEngine/generators/remedialPengayaanGenerator.ts`
- `src/services/documentEngine/generators/tpGenerator.ts`
- `src/services/documentEngine/index.ts`
- `src/services/documentEngine/jpPresentation.ts`
- `src/services/documentEngine/jurnalProjection.ts`
- `src/services/documentEngine/modulAjarExportContext.ts`
- `src/services/documentEngine/modulAjarProjection.ts`
- `src/services/documentEngine/promesPresentation.ts`
- `src/services/documentEngine/promesProjection.ts`
- `src/services/documentEngine/protaProjection.ts`
- `src/services/documentEngine/renderers/pdf/pdfDocGenerators.ts`
- `src/services/documentEngine/snapshot.ts`
- `src/services/documentEngine/sourceIdentityGuard.ts`
- `src/services/documentEngine/zipBundle.ts`
