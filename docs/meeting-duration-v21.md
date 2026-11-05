# Konsistensi durasi JP per pertemuan V21

Baseline: `115216ef8a3998937c51a69385c24d100a4092bc`, branch `main`, repository `pkbmcwd92-cpu/Alco-Adm-v21-Penyesuaian-JP-dan-Jadwal`. Checkout awal bersih. Perubahan lokal; belum commit/push.

## Akar masalah dan audit caller

`learningPlanActivityMeetingService.ts` menghitung `jp * 35` tanpa konteks jenjang. Prompt awal server, prompt satu kali perbaikan AI, dan tiga deskripsi schema fase mengulang asumsi itu. Akibatnya validator dapat mengesahkan durasi SMP/SMA yang terlalu pendek. Jadwal sudah menyimpan JP per ID sesi; masalahnya ada pada konversi menit, bukan algoritma slot.

Seluruh caller produksi `validateLearningPlanActivityMeetings` diaudit dan diperbarui:

| Caller | Konteks baru |
|---|---|
| `learningPlanService.validateLearningPlan` | AcademicSetting aktif + JP dari baris proyeksi jadwal pada semester/meetingId yang tepat |
| `learningPlanService.createAIDraftLearningPlan` | AcademicSetting dan meeting scope yang diberikan pemanggil |
| `aiService.generateLearningPlanWithAI` | AcademicSetting dan scope request; respons diperiksa sebelum diterima |
| `server.validateAILearningPlanPayload` | AcademicSetting request; dipakai pada respons awal dan respons perbaikan |

Kontrak empat argumen awal validator dipertahankan, dengan argumen kelima AcademicSetting opsional secara tipe. Aktivitas global legacy tanpa scope meeting tetap kompatibel. Scope meeting yang memerlukan anggaran tetapi tidak mempunyai konteks jenjang/JP valid ditolak dengan alasan jelas; tidak ada fallback 35 menit.

## Implementasi dan file produksi

1. `src/services/learningPlanActivityMeetingService.ts`: tambah `resolveLearningPlanMeetingBudgets` di service existing. Menit/JP berasal dari `resolveCurriculumContext().minutesPerJP`; tidak ada tabel hardcode baru. Jenjang, kelas, kurikulum, mapel dan TA harus dapat diresolusi; jenjang/kelas tidak cocok, konteks tidak valid, JP non-integer/nonpositif, ID kosong/duplikat ditolak. Budget hanya objek sementara, bukan field persistensi struktur pertemuan.
2. `src/services/aiService.ts`: request menyertakan `meetingId`, JP aktual, `minutesPerJP`, dan `durationMinutes` untuk setiap pertemuan. Preflight menolak konteks tidak valid sebelum fetch. Respons memakai validator bersama.
3. `server.ts`: server menghitung ulang budget dari konteks request; budget kiriman client tidak dipercaya. Request lama dengan JP/context valid tetap diterima meskipun belum mengirim field budget baru. Prompt awal, repair prompt dan schema memakai anggaran masing-masing ID. Validasi awal dan setelah satu percobaan repair memakai konteks sama. Model/provider/retry policy tidak diubah.
4. `src/services/learningPlanService.ts`: validasi memakai budget jenjang; hasil `needsReview` diturunkan dari validasi, tanpa menulis status atau kegiatan tersimpan. Konteks kalender/jadwal aktual opsional diteruskan ke `isLearningMeetingScheduleReady` existing agar perubahan kalender, libur, JP, atau timestamp jadwal diperiksa kembali. Konfirmasi SIAP memakai pemeriksaan sama.
5. `src/components/administration/LearningPlanManager.tsx`: meneruskan kalender, hari, pola mingguan dan setting JP ke validasi/konfirmasi/ekspor. Preflight jadwal existing juga dijalankan sebelum AI. Memo validasi mengikuti perubahan konteks itu. Badge validasi existing menampilkan **Perlu Ditinjau**; tidak ada panel/editor baru.
6. `src/components/administration/AdministrationHub.tsx`: meneruskan konteks waktu existing ke LearningPlanManager.
7. `src/services/documentEngine/modulAjarProjection.ts`: budget menit/JP dan total menit per meeting berasal dari resolver budget yang sama. PDF memakai section proyeksi ini. Pengalaman belajar UNDERSTAND/APPLY/REFLECT diberi label pendekatan kegiatan inti tanpa mencetak durasi tambahan, konsisten dengan DOCX.
8. `src/services/documentEngine/generators/modulAjarGenerator.ts`: header pertemuan mencetak total menit dari proyeksi, tanpa konversi sendiri.

Master regulasi, CP/TP/ATP, mapping Bab, UnitExecutionPlan, algoritma alokasi jadwal dan schema Storage V5 tidak diubah. Tidak ada JP permanen baru pada struktur pertemuan. Tanggal dan JP tetap berasal dari `LearningMeetingScheduleData.entries` yang diproyeksikan berdasarkan ID.

## Bukti slot aktual → AI → validasi → Modul Ajar

`scripts/testMeetingDurationByLevel.ts` membangun slot dengan resolver produksi, memasangkan pertemuan ke slot dan membentuk persisted schedule dengan builder produksi. JP legacy pada fixture UnitExecutionPlan dihapus untuk membuktikan bahwa konversi tidak menggunakannya.

| Kasus | Budget yang dibuktikan |
|---|---|
| SD, 3 JP | 105 menit |
| SMP, 3 JP | 120 menit |
| SMA, 2 JP | 90 menit |
| Matematika SD, 3+2 JP | 105 dan 70 menit pada ID berbeda |
| Dua sesi pada Senin yang sama | Tidak digabung berdasarkan tanggal; anggaran tetap per meetingId |
| SMP, 2 JP, setelah reload/import | 80 menit pada proyeksi, DOCX dan PDF asli |

Tes menjalankan client request builder dan kode Express handler/schema/prompt/validator sebenarnya melalui isolasi VM. Hanya batas provider AI yang diganti respons deterministik; tidak ada panggilan Gemini produksi. Prompt awal memuat budget tiap ID, repair prompt mempertahankan budget yang sama, dan respons salah dua kali menghasilkan HTTP 400 dengan alasan jumlah menit yang diharapkan. Payload client dengan budget palsu dihitung ulang oleh server.

Pembukaan + inti + penutup wajib tersedia, positif, dan jumlahnya tepat untuk **masing-masing ID**. Total benar pada tingkat Unit tidak menutupi kesalahan salah satu pertemuan. Durasi pengalaman belajar tidak menjadi anggaran tambahan.

DOCX benar-benar dibuat dan XML-nya dibaca; PDF benar-benar dibuat dan teks semua halaman diekstrak. Anggaran header dan aktivitas memakai proyeksi yang sama. Tidak mengklaim visual QA layout seluruh halaman.

## Data lama, kalender dan penyimpanan

- SD dengan konteks valid tetap memakai 35 menit/JP. Aktivitas global legacy tetap tidak dipetakan otomatis ke meeting baru.
- SMP/SMA yang masih menggunakan durasi lama tidak disunting, tidak dihapus, tidak diregenerasi, dan tidak diturunkan status persistensinya otomatis. Validasi turunan memberi `needsReview=true`, alasan durasi yang benar, dan mencegah konfirmasi/ekspor Modul Ajar yang tidak konsisten.
- Tes membuktikan stored status SIAP tetap tersimpan, sedangkan proyeksi outputnya ditolak untuk review; payload storage dan jumlah write tidak berubah selama pemeriksaan.
- Perubahan JP aktual memicu validasi ulang. Libur di luar slot tidak mengubah validitas; libur pada slot atau perubahan timestamp pola mengakibatkan review melalui validator jadwal existing.
- V5 serialize/parse/reload serta pembuatan ZIP proyek, pembacaan ZIP dan import CONTINUE_EDITING ke profil/sekolah lain memakai implementasi produksi. Data SMP valid tetap menghasilkan DOCX/PDF 80 menit setelah remapping ID.
- Tidak ada perubahan writer/migration/import/export untuk memperbaiki data secara diam-diam.

## Tes dan build

Lulus:

- `npm.cmd run test:meeting-duration-v21` — seluruh kasus level, pola 3+2, dua sesi sehari, request/server/repair/client/factory, penolakan input invalid, kalender/libur/stale, storage/reload/import, DOCX/PDF asli dan input immutable.
- `tsx scripts/testMeetingPhaseDurationRegression.ts` — fase opening/core/closing, budget per ID, durasi experience bukan tambahan, validator server/client/factory dan heading fase DOCX.
- `tsx scripts/testLearningPlanActivityProducerRegression.ts` — linkage AI/manual/global legacy dan handler selector existing.
- `tsx scripts/testModulAjarMeetingProjectionRegression.ts` — lineage meeting dan parity proyeksi dokumen.
- `tsx scripts/testModulAjarRuntimeExportRegression.ts` — export live vs snapshot historis valid, callback unduh dan receipt/build identity.
- `npm.cmd run test:step08-jp`.
- `npm.cmd run test:jp-regulation-v21` — 493 rule, master tidak diubah.
- `tsx scripts/testJPFoundationRegression.ts`.
- `npm.cmd run build` — Vite frontend, PWA dan esbuild server. Ada warning bundle >500 kB.
- `git diff --check`.

Fixture yang diselaraskan dengan kontrak baru: `scripts/fixtures/modulAjarRuntimeFixture.ts` dan fixture inline `testModulAjarMeetingProjectionRegression.ts` kini mempunyai level SMP eksplisit dan budget 2 JP = 80 menit (10+60+10). `testMeetingPhaseDurationRegression.ts` secara eksplisit menguji SD 105 menit. `testLearningPlanActivityProducerRegression.ts` memakai SMP 80 menit. Split core pada `testModulAjarRuntimeExportRegression.ts` menjadi 55+5 agar tetap 60 menit, dengan maksud tes revisi dokumen tetap sama. `package.json` menambah satu perintah tes; dependency tidak diubah.

Pemeriksaan yang belum hijau, dipisahkan dari koreksi durasi:

- `npm.cmd run lint`: 67 diagnostic fixture existing; tidak ada diagnostic yang menunjuk file produksi yang diubah atau tes durasi baru. Empat error tipe return helper yang ditemukan selama implementasi sudah diperbaiki, bukan dibiarkan sebagai error lama.
- `npm.cmd run test:curriculum`: bagian JP lolos, lalu assertion sumber CP historis 2024/2025 (`DEC-BSKAP-032-2024`) gagal seperti batas baseline yang telah dicatat. CP engine tidak diperbaiki.
- `tsx scripts/testFourAdministrationImportModes.tsx`: gagal pada ekspektasi satu unduhan, aktual nol. Audit `git show HEAD` membuktikan baseline `identityOnlyProjectExport.ts` sudah memasang `skipDownload: true`, sedangkan zipBundle hanya mengunduh bila flag itu false. Tidak mengubah perilaku impor/unduh di luar scope. Run diagnostik menghasilkan ZIP berisi dua Modul Ajar SUCCESS dengan PDF/DOCX; satu jenis dokumen lain (PEMETAAN_ATP_UNIT) dilewati karena fixture ATP tidak mempunyai Unit/Bab.

## Risiko tersisa dan batas bukti

Tidak ada live-provider, browser klik end-to-end, atau visual QA dokumen pada perangkat pengguna. Status kesiapan yang dibuktikan adalah integrasi resolver/request/handler/validator/byte dokumen dan persistence. Input tanpa konteks jenjang/kelas/mapel kurikulum yang teresolusi memerlukan review eksplisit; tidak diberi default 35. API server bersifat stateless: ia dapat memverifikasi konversi dan scope payload, sedangkan kebenaran slot kalender tetap dijaga pada pemanggil melalui validator jadwal aktual existing. Konteks legacy tanpa data kalender tetap diperiksa durasinya, tetapi tidak dapat membuktikan kesegaran kalender yang tidak disertakan.
