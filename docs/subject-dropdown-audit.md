# Dropdown mapel berdasarkan CP aktif

Audit sebelum revisi menemukan pilihan masih berasal dari struktur JP dan keanggotaan
katalog CP, tanpa resolusi tahun ajaran. Katalog SMK ditampilkan meskipun registry CP
bawaan belum memuat SMK. Implementasi ini mengganti dasar pilihan tersebut, tanpa
mengubah master, resolver, adapter, metadata, atau mekanisme pemilihan CP di Step 3.

## Perilaku

- Kode/nama tetap berasal dari subjects.ts (master lama dan identitas CP046).
- Kandidat berasal dari ALL_MASTER_CP_ENTRIES (termasuk SD) dan
  REVIEW_CP046_ENTRIES (adapter JSON SMP/SMA), bukan struktur JP.
- Untuk konteks lengkap, resolveCPContext memeriksa mapel, jenjang, fase dan tahun
  ajaran. Pilihan aktif harus memiliki setidaknya satu sumber RESOLVED dengan
  subjectCode yang sama persis. Hasil fuzzy ke kode lain tidak diterima.
- Pool bawaan/historis dan REVIEW 046 diperiksa terpisah seperti mekanisme pilihan
  sumber CP yang sudah ada. Keduanya tidak digabung menjadi satu pool ambigu dan
  tidak diprioritaskan otomatis. Pool AMBIGUOUS tidak ditawarkan sebagai sumber
  tersedia; jika pool lain RESOLVED, hanya sumber itu yang ditampilkan tersedia,
  dengan pemberitahuan sumber lain ambigu. Pemilihan tetap eksplisit di Step 3.
- Label menyertakan verifikasi/regulasi asli. REVIEW tetap UNVERIFIED. Tahun ajaran
  mengikuti applicability registry, termasuk pembatasan CP agama 046 pada 2026.
- Profil hanya memiliki jenjang: dropdown adalah katalog sementara, tanpa klaim
  CP tersedia sebelum kelas/fase dan tahun ajaran dilengkapi. AcademicSettings,
  modal administrasi baru, dan beban mengajar mengirim tahun ajaran aktual.
- K13 menampilkan katalog dengan label KI/KD, tanpa klaim ketersediaan CP. SMK
  tidak diberi CP bawaan fiktif; input khusus/manual tetap tersedia.
- Mapel lama tetap ditampilkan walaupun CP bawaan tidak tersedia/ambigu. Nilai,
  kode, isian manual, JP override dan dependensi tersimpan tidak berubah pada
  render, pergantian mode editor, atau normalisasi tampilan. Memilih identitas
  yang sama mempertahankan string lama dan tidak mereset JP.
- Jalur manual dijelaskan: isi/salin teks CP, elemen dan sumber di Step 3, lalu
  simpan eksplisit. Dropdown tidak mengambil CP, menulis storage, menaikkan status
  verifikasi atau memicu migrasi/stale detection.

## Regresi

TestSubjectSelectionRegression menjalankan resolver asli untuk SD A/B/C, SMP D,
SMA E/F pada 2024/2025, 2025/2026 dan 2026/2027; 84 record JSON dan identitas
sumber; status REVIEW; isolasi agama 2026; sumber ambigu, kosong dan campuran;
profil parsial; K13/SMK; handler/render dropdown; perubahan tahun/jenjang/mapel;
mapel khusus; serta perlindungan nilai lama dan JP. Ambiguitas disimulasikan
hanya dalam array registry pada proses tes dan dipulihkan setelah setiap kasus.

Risiko tetap mengikuti isi registry. Contohnya resolver bawaan belum menemukan
PJOK SD A pada 2024/2025; dropdown menampilkan nilai tersimpan dan jalur manual,
tidak mengarang sumber atau memperbaiki metadata secara otomatis. Tidak ada
inspeksi visual browser pada revisi ini.

## Hasil validasi

- PASS: regresi dropdown/resolver di atas; 84 record SMP/SMA, 327 elemen dan
  30 subelemen pada CP046 safety/review; COPY/ZIP restore; profil-sekolah;
  Storage V5 contract; complete-project ZIP archive; snapshot dokumen; build
  produksi (Vite, PWA dan server).
- FAIL baseline: TypeScript tetap 68 diagnosis identik dengan pemeriksaan
  sebelum revisi, tanpa tambahan atau pengurangan diagnosis.
- FAIL baseline: testCP046CompatibilityRegression memuat impor JSON baseline
  sebagai .json.ts; testCurriculumMaster gagal pada sumber CP historis 2024/2025.
  Kedua skrip dan seluruh dependency curriculum/data/resolver-nya tidak berubah.
  Kegagalan yang sama sudah tercatat sebelum revisi pada audit dropdown sebelumnya.

File berubah: src/services/subjectSelection.ts, src/components/SubjectSelect.tsx,
src/components/AcademicSettings.tsx, src/App.tsx,
src/components/TeacherTeachingLoadModal.tsx,
scripts/testSubjectSelectionRegression.tsx dan laporan ini. ProfileManager sudah
menggunakan SubjectSelect berdasarkan defaultLevel; perilaku barunya berasal
dari kontrol bersama tersebut tanpa perubahan/pemindahan nilai profil.
