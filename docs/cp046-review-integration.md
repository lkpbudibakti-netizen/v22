# Integrasi CP SMP/SMA BSKAP 046/2025

Branch: `feat/cp-smp-sma-046-2025`, PR #1. Baseline audit: `7dd4c39f107c184719c6069165a265709f66d6f9`.

## Kontrak akhir: penambahan sumber eksplisit

- Registry default `ALL_MASTER_CP_ENTRIES`, ekspor SMP/SMA, resolver dan pencarian historis tetap sama dengan main (62 sumber). Tidak ada supersedesEntryIds, prioritas baru atau migrasi proyek.
- `REVIEW_CP046_ENTRIES` memuat 22 SMP Fase D dan 62 SMA Fase E/F sebagai registry terpisah. Resolver/repository mengaksesnya hanya dengan `sourceSet: review046`. Kandidat ganda dalam registry yang sama tetap AMBIGUOUS, tidak memakai first-match.
- CPManager menawarkan kedua kelompok sumber dengan label REVIEW dan alasan pemisahan. CP046 tidak dipilih otomatis. Tindakan Muat Sumber REVIEW ke Draft hanya mengubah state editor lokal; tidak memanggil onSaveCP. Simpan CP tetap merupakan tindakan eksplisit pengguna.
- Konfirmasi, metadata dan identitas CP proyek saat menerapkan sumber historis mengikuti main. Tidak ada penulisan ulang cpId/cpVersion/regulationIds. Sumber baru membawa provenance pada cp.source dan sourceElementKey.
- Katalog global serta fuzzy matching lama dipertahankan persis. Katalog CP046 memakai identitas terpisah untuk varian Prakarya/PKWU, enam bahasa asing dan Sejarah Tingkat Lanjut; tidak mengalihkan alias proyek lama. Pilihan mapel baru ditambahkan setelah pilihan lama.

## Data dan regulasi

84 sumber memuat 327 elemen dan 30 subelemen. Adapter mempertahankan teks asli, ID sumber, induk elemen, hierarki, nomor PDF dan metadata halaman. Awalan label SMA hanya dipisahkan ketika cocok persis diikuti whitespace; JSON asli tidak berubah. Semua sumber impor UNVERIFIED dan JSON tetap REVIEW.

Metadata regulasi historis dikembalikan ke main. Bukti PDF khusus impor tetap tersedia melalui evidence/sourceReview. Agama 046/2025 tidak digunakan untuk mengganti agama 2026; masa implementasi agama 2026 tetap memerlukan review naskah hukum. Tidak mengisi kekosongan sumber agama SMA F tahun 2026/2027 dengan data 2025.

Layanan storage, COPY/ZIP, App dan alur TP/ATP/PROTA/PROMES/modul ajar tidak diubah. Tidak ada migrasi atau penggantian CP tersimpan saat pencarian/pemilihan sumber.

Hasil pemeriksaan terakhir dan batas pembuktian tersedia di [cp046-final-audit.md](cp046-final-audit.md).
