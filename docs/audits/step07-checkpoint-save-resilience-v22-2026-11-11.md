# Step 07: Perbaikan CHECKPOINT_SAVE_FAILED & Batas Pertumbuhan Checkpoint

Baseline: commit `0f786122482d94461cd009dba7fdd25d86408769`, branch `main`.

## 1. Akar Masalah Terbukti & Analisis Pertumbuhan Ukuran

### Pertumbuhan Ukuran Checkpoint
Sebelum perbaikan, setiap siklus analisis (termasuk pada Analisis Ulang per Bab) menyebabkan pertumbuhan kumulatif pada struktur checkpoint:
1. **Akumulasi `responses` per Bab**: `point.responses ||= []; point.responses.push(...)` menyimpan seluruh respons mentah AI (PROPOSE dan VERIFY) tanpa batas, menambah ~1.3–2.5 KB per panggilan.
2. **Akumulasi `events` per Bab**: Array `point.events` terus bertambah setiap tahap eksekusi (PROPOSE, VERIFY, FILTER, APPLY, VALIDATE, SAVE), menambah ~2–5 KB per Bab per siklus.
3. **Akumulasi snapshot `invalidated`**: Setiap kali dependensi/sumber Bab berubah, `checkpoint.invalidated.push({ unitId, reason, checkpoint: entry })` menyimpan seluruh salinan objek Bab lama beserta respon dan historinya.
4. **Duplikasi `beforeUnits`**: `beforeUnits` dapat menyimpan duplikasi objek unit bila beberapa siklus berjalan.
5. **Payload `workingMapping`**: Menyimpan draft kerja penuh (~50 KB) di dalam checkpoint terpisah dari V5.

Pada 35 siklus pengujian berulang pada Bab 1, 4, dan 7, checkpoint tanpa batas tumbuh melampaui **400+ KB**. Saat mendekati limit kuota browser (`localStorage` ~5MB total di origin bersama V5), `localStorage.setItem` melempar `QuotaExceededError`.

### Klasifikasi Error yang Tidak Spesifik
Sebelumnya, seluruh error pada `localStorage.setItem` ditangkap secara umum dan dilempar sebagai:
`CHECKPOINT_SAVE_FAILED: penyimpanan lokal penuh/tidak tersedia.`
Pesan ini tidak membedakan antara:
- Kuota penyimpanan penuh (`QuotaExceededError`)
- Storage diblokir/tidak tersedia (private mode, izin browser)
- Kegagalan serialisasi (circular/invalid JSON)

---

## 2. Pengukuran Ukuran Checkpoint Sebelum & Sesudah

Berdasarkan pengujian siklus berulang pada proyek PJOK Kelas 6 (9 Bab, 27 materi):

| Skenario | Ukuran Sebelum | Ukuran Sesudah | Pengurangan / Status |
|---|---|---|---|
| **Checkpoint Awal (1 siklus selesai)** | ~160 KB | ~103 KB | **-35.6%** |
| **Simulasi 20 siklus berulang** | ~204 KB | ~160 KB | **-21.6%** (stabil & bounded) |
| **Simulasi 35 siklus Bab 1, 4, 7** | > 400 KB | ~152 KB | **-62.0%** (berhenti tumbuh) |
| **Emergency Pruning saat Quota Exceeded** | ~153 KB | ~102 KB | Berhasil disimpan tanpa melempar error |

---

## 3. Implementasi Perbaikan

### A. Klasifikasi Error Penyimpanan Spesifik (`classifyCheckpointStorageError`)
Diimplementasikan pada `src/services/step07CheckpointService.ts`:
- **`CHECKPOINT_QUOTA_EXCEEDED`**: Kuota browser penuh (`QuotaExceededError` / code 22 / `NS_ERROR_DOM_QUOTA_REACHED`). Menampilkan pesan spesifik: *"kuota penyimpanan browser (localStorage) penuh. Draft tersimpan sebelumnya tetap aman di V5; kosongkan cache situs atau ekspor cadangan profil."*
- **`CHECKPOINT_SERIALIZATION_FAILED`**: Struktur data gagal diserialisasi (`TypeError` / circular).
- **`CHECKPOINT_STORAGE_UNAVAILABLE`**: Storage dinonaktifkan oleh izin browser atau lingkungan private.
- **`CHECKPOINT_SAVE_FAILED`**: Error I/O umum dengan pesan asli error.

### B. Kompaksi Checkpoint Bounded (`compactStep07Checkpoint`)
Dijalankan sebelum setiap `writeStep07Checkpoint`:
1. **Deduplikasi `beforeUnits`**: Memastikan tidak ada duplikasi ID unit pada `beforeUnits`.
2. **Pembatasan `invalidated`**: Maksimal 10 record terakhir; menghapus payload berat (`analysis`, `proposal`, `verification`, `responses`) dari entri yang diinvalisir.
3. **Pembatasan `events`**: Maksimal 30 event per Bab dengan prioritas mempertahankan event kegagalan semantik/verifikasi (`keptFailed` + `keptSuccess`).
4. **Pembatasan `responses`**: Maksimal 3 respons AI terakhir per Bab untuk kebutuhan diagnostik.
5. **Deduplikasi `rejected`**: Menghapus duplikasi ID aksi yang ditolak.

### C. Pemulihan Darurat Saat Mendekati Kuota (`pruneCheckpointForEmergency`)
Jika `localStorage.setItem` melempar `QuotaExceededError`:
1. Menghapus buffer sementara `workingMapping` (karena V5 adalah sumber kebenaran kanonikal tunggal).
2. Memangkas `invalidated` menjadi 2 entri ringkas.
3. Menghapus `responses` dan proposal/analisis dari Bab yang sudah `DONE` atau `BLOCKED`.
4. Mencoba menyimpan ulang. Jika tetap gagal, melempar error terklasifikasi dengan aman tanpa merusak snapshot V5 yang sudah tersimpan.

### D. Integritas V5 dan Data Guru
- V5 tetap menjadi *single source of truth*.
- Kegagalan penyimpanan checkpoint tidak menghapus atau mengubah data guru di V5.
- Data checkpoint yang gagal disimpan dipertahankan pada memori runtime; draft tersimpan sebelumnya di V5 tidak pernah direset.

---

## 4. Hasil Pengujian Verifikasi

Semua skenario pengujian lulus dengan status **PASS**:

- **`test:step07-save-resilience`** (Suite Baru, 5 skenario):
  1. *Differentiate storage errors*: PASS
  2. *Repeated analysis of Bab 1, 4, 7 bounded size*: PASS (152,203 chars terukur pada siklus ke-35)
  3. *Automatic emergency pruning on quota exceeded*: PASS (pruning otomatis berhasil simpan saat melampaui threshold)
  4. *Hard storage failure fails safely without altering V5*: PASS (V5 dan checkpoint mentah utuh)
  5. *Compaction removes duplicate beforeUnits by ID*: PASS (27 unit terduplikasi terkompaksi kembali menjadi 9 unit unik)
- **`test:step07-target`** (12/12 skenario): PASS
- **`test:step07-checkpoint`** (20/20 skenario): PASS
- **`test:step07-progress`** (7/7 skenario): PASS
- **`test:step07-diagnostics`** (8/8 skenario): PASS
- **`test:step07-real-project`** (5/5 skenario): PASS
- **`test:step07-auto`** (29/29 skenario): PASS
- **`test:step07-timeout`** (4/4 skenario): PASS
- **`compile_applet`**: PASS (Build succeeded)
- **`lint_applet`**: PASS (`tsc --noEmit` clean, 0 error)
