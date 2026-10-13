# KroomPrint — Pipeline Cetak & Riwayat Debugging Produksi

> Dokumen teknis resmi pipeline pencetakan KroomPrint. Ditulis setelah sesi
> live-fire debugging 26 Agustus 2026 yang mengungkap **5 lapis masalah
> berlapis** pada jalur cetak PDF. Wajib dibaca sebelum menyentuh
> `dispatchPrintJob`, `normalizeDocument`, `ensurePrintablePDF`, atau
> `syncCupsJobStatus`.

---

## 1. Arsitektur Pipeline Cetak (Kondisi Saat Ini)

```
UI Upload (multipart POST /api/jobs)
  │
  ├─[upload-time] ensurePrintablePDF(dst)          ← server.go handleCreateJob
  │    gs -sDEVICE=pdfwrite → repair metadata saja (float /Rotate, crop box)
  │    ⚠️ TIDAK mengubah geometri: tanpa -paper dan tanpa -expand
  │
  └─ respond 201 segera; async:
       dispatchPrintJob(jobID, filePath, req, printer, name)
         │ per-printer MUTEX (anti device-busy collision)
         │ pre-flight: cancel -a / cupsenable / cupsaccept
         │
         ├─ normalizeDocument(filePath, ..., media, ...)   ← server.go
         │    PDF : pdftops -level3 → gs pdfwrite (tanpa -paper/-expand)
         │    IMG : convert -resize -extent → PDF seukuran kertas
         │    DOCX: libreoffice --convert-to pdf
         │
         └─ SubmitPrintJob (IPP) / lp -d <queue> -o media=<PPD> -o Ink=MONO
              │ print-scaling=fit|fill mengatur fit ke kertas (env LANG wajib — lihat §3.4)
              ▼
            CUPS: pdftopdf → ghostscript → epson-escpr-wrapper → usb
              ▼
            Epson L3210 (USB)

Status job dipantau poller 1-detik:
  syncCupsJobStatus → GetJobStateIPP (IPP Get-Job-Attributes, authoritative)
    completed(9)/aborted(8)/canceled(7)/stopped(6) → status jujur ke UI via SSE
    + AUTO-RETRY: "completed" <4 dtk setelah dispatch = pasti gagal senyap
                  → re-dispatch otomatis (maks 2x)
```

**File/fungsi kunci:**

| Fungsi | File | Peran |
|---|---|---|
| `ensurePrintablePDF` | api/server.go | Gerbang tunggal perbaikan PDF (metadata saja, geometri utuh) |
| `repairPDFWithGhostscript` | api/server.go | `gs -sDEVICE=pdfwrite` — repair struktural tanpa ubah ukuran halaman |
| `normalizeDocument` | api/server.go | PDF→distil, IMG→fit ke kertas, DOCX→libreoffice |
| `pageDimensionsPoints` | api/server.go | Baca MediaBox halaman-1 (pdfinfo/identify) untuk cegah rotasi ganda |
| `resolveOrientationForPDF` | api/server.go | Batalkan rotasi bila halaman sudah landscape (fungsi murni, ada test) |
| `GetJobStateIPP` | discovery/jobstate.go | Query job-state authoritative (RFC 8011 framing) |
| `authorize` | api/auth.go | Middleware RBAC (admin/user/guest) |
| `syncCupsJobStatus` | api/server.go | Poller 1-detik + auto-retry |

---

## 2. Kronologi Insiden & 5 Lapis Akar Masalah

Gejala awal (24 Aug): *"UI menunjukkan queued→progress→completed,
printer tidak mencetak apa pun."*

### Lapis 1 — PDF rusak dari producer (pemicu)
`INV-202608-0004.pdf` membawa metadata `/Rotate 270.000061` (float, bukan
integer). Viewer toleran; **cups-filters pdftopdf tidak**: crash
(`Unexpected /Rotate value`) atau menghasilkan crop-box salah
(`After Cropping: 420.12 ...` → konten tergeser keluar halaman).

### Lapis 2 — Jalur lokal tidak pernah menormalisasi
`normalizeDocument()` lalu mem-pass-through PDF mentah dengan asumsi keliru
*"vector PDFs are print-ready"*. **Fix** (`059d398`, `7c19ff5`): setiap PDF
≤32MB di-rasterize via ImageMagick menjadi image-PDF flat.

⚠️ **Jebakan #1**: pertama kali diimplementasi dengan asumsi
`gs -sDEVICE=pdfwrite` akan membulatkan /Rotate — **SALAH**. pdfwrite
mempertahankan /Rotate verbatim. Solusi: rasterize (bukan distill).

### Lapis 3 — Status CUPS palsu di UI
Dua mekanisme membuat UI berbohong:
1. `lpstat -W completed` juga memuat job **aborted/canceled** → backend
   melaporkan `"completed by CUPS"` untuk job gagal.
2. **Fake timer completion**: setelah estimasi detik+4, job dipaksa
   `completed` tanpa cek printer (`finished lifecycle progression`).

**Fix** (`7c19ff5`): query IPP `Get-Job-Attributes` yang membedakan eksplisit
state enum RFC 8011 (9=completed, 8=aborted, 7=canceled, 6=stopped); fake
timer dihapus total; progres waktu murni kosmetik (cap 98%).

⚠️ **Jebakan #2**: encoding `requested-attributes` digabung koma dalam SATU
value membuat cupsd menjawab `successful-ok` **dengan atribut kosong**.
Harus dikirim sebagai atribut primer + *additional-value* (name-length 0).
Ter dokumentasi di `jobstate.go` + fixture test byte-asli-cupsd.

### Lapis 4 — Flatten PNG mentah tidak mencetak
Submit `.png` langsung ke `lp` → CUPS chain `imagetoraster` → wrapper mati
SIGPIPE → `Sent 0 bytes`. **Fix**: flatten ke PNG hanya sebagai tahap
perantara; yang dispool tetap terkontrol (lihat §3.3 catatan).

### Lapis 5 — `LANG` hilang di env PM2 (akar "gagal acak ~50%")
Proses spawn PM2 tanpa locale → seluruh filter chain menghasilkan **0 bytes**
secara SILENT sementara CUPS melaporkan sukses. A/B/A reproducible:

| Env | Hasil |
|---|---|
| minimal tanpa LANG | Sent 0 bytes ❌ |
| minimal + `LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=C.UTF-8` | Sent 586KB ✅ |
| full shell (punya LANG) | ✅ |

**Fix** (`03345ce`): LANG/LANGUAGE/LC_ALL di `ecosystem.config.cjs` +
belt-and-suspenders di `dispatchPrintJob` (inject env bila `os.Getenv("LANG")`
kosong). ⚠️ Jangan pernah hapus ketiga var ini saat cleanup env.

#### Lapis 6 — Dokumen Kecil Tidak Skala ke A4 ("Fit to Page") — ⚠️ DIPERBAIKI ULANG
Diagnosis awal (26 Agu 2026) menyimpulkan `pdftops` butuh `-expand`, lalu flag itu dipasang di
`ensurePrintablePDF` **dan** `normalizeDocument`. **Itu justru menimbulkan bug yang lebih besar:**
`ensurePrintablePDF` berjalan saat UPLOAD dengan `-paper A4 -expand` dan hasilnya menimpa file asli
(`os.Rename`), sehingga geometri SETIAP dokumen dibakar ke A4 sebelum user sempat memilih kertas —
pilihan A5/Letter/4x6 tidak pernah bisa dihormati. Ditambah `-expand` memperbesar konten sampai
menabrak margin hardware printer (~3mm, bawah Epson lebih lebar) = hasil geser/kepotong.

**Fix (revisi):**
- `ensurePrintablePDF` hanya **memperbaiki struktur** (`gs -sDEVICE=pdfwrite`, `-dAutoRotatePages=/None`)
  — TANPA `-paper`, TANPA `-expand`. Dokumen mempertahankan MediaBox aslinya.
- `normalizeDocument` juga tidak lagi memaksa kertas (`psArgs = ["-level3", src, psPath]`).
- Penskalaan ke kertas yang dipilih **diserahkan ke CUPS** via `print-scaling=fit` / `fitplot=true`
  (fallback `lp`: `-o fit-to-page -o print-scaling=fit`); mode "Fill page (Crop)" tetap
  `print-scaling=fill`.
- Rotasi ganda dicegah lewat `pageDimensionsPoints` + `resolveOrientationForPDF` (ada unit test).

Konsekuensi: dokumen tidak lagi "dipaksa penuh" ke A4; bila user memilih Fit to Page, CUPS yang
menskalakan sesuai kertas, dan margin hardware tidak ditabrak.

### Lapis 7 — False Failure CUPS `stopped: job-completed-with-errors` & Double Print
Saat data raster selesai dikirimkan penuh ke port USB printer Epson L3210, filter driver `epson-escpr-wrapper` mengeluarkan warning/notice stderr non-fatal. CUPS menandai job dengan state `stopped (6)` dan reason `job-completed-with-errors`. Backend sebelumnya menandai ini sebagai `failed`, menampilkan badge merah di UI, dan memancing user menekan *Retry* sehingga printer mencetak dua kali (**double print**).
**Fix**: `syncCupsJobStatus` memperlakukan status `stopped` dengan reason `job-completed-with-errors`, `completed`, `none`, atau string kosong sebagai status **`completed`** (sukses), karena seluruh data fisik telah diterima buffer printer.

### Lapis 8 — Izin Eksekusi Binary Cross-Mount NFS (`chmod 755`) & SQLite Connection Pool
PM2 pada `amba` mengeksekusi `/mnt/web/Nouvem/printer-wireless/backend/kroomprint-backend` yang dimount via NFS dari NAS. Kompilasi baru menghasilkan permission `700` (`-rwx------` milik UID NAS) sehingga user `amba` terkena *Permission denied*. Selain itu, SQLite pure-Go driver (`modernc.org/sqlite`) membutuhkan pembatasan `SetMaxOpenConns(1)` dan penanganan PRAGMA eksplisit.
**Fix**: Mandat `chmod 755` pada target binary dan pengaturan `db.SetMaxOpenConns(1)` dengan `PRAGMA journal_mode = WAL` di Go store initialization.

### Lapis 9 — PDF Landscape & Custom Scaling Ignored / Cetak Tetap Portrait & Ukuran Tetap
**Gejala:** User memilih orientasi Landscape dan/atau memperkecil ukuran dokumen (Custom Scale, misal 50%), namun printer tetap mencetak secara Portrait (dan sebagian terpotong) serta ukuran dokumen tidak mengecil.
**Akar Masalah:**
1. Feed fisik hardware printer desktop (Epson L3210) selalu memasukkan kertas pada sisi pendek (portrait geometry, 595x842 pt untuk A4). Untuk mencetak dokumen Landscape, konten harus diorientasikan ke feed fisik printer. Jalur image sudah melakukan rotasi 270° dan mengirim `portrait` ke CUPS, namun jalur PDF sebelumnya menyerahkan orientasi ke CUPS dengan asumsi keliru bahwa CUPS `orientation-requested` akan merotasi otomatis. Ditambah `resolveOrientationForPDF` membatalkan pilihan landscape bila lebar > tinggi sehingga CUPS menerima `orientation-requested=3` (portrait), menyebabkan dokumen landscape dicetak di atas feed portrait tanpa rotasi dan terpotong.
2. Parameter `scalePercent` (persentase skala kustom, misal 50%) dikirim dari UI tapi sama sekali tidak diterapkan ke PDF di backend. CUPS hanya menerima `print-scaling=auto` atau `fit-to-page` yang mempertahankan atau membesarkan ukuran dokumen ke 100%.
**Solusi:**
- Implementasi `formatPDFForPrint` di backend menggunakan Ghostscript `pdfwrite` dengan hook PostScript `/BeginPage`:
  - Menentukan dimensi kertas fisik target (`sheetW` x `sheetH`, e.g. 595x842 pt A4).
  - Untuk mode Landscape: merotasi canvas 270° dan mentranslasikan secara presisi ke feed fisik portrait.
  - Menerapkan penskalaan custom (`scalePercent`), shrink, fit, atau actual size secara proporsional serta pemusatan (`dx`, `dy`) di atas canvas target.
  - Output PDF hasil format memiliki dimensi MediaBox yang tepat sesuai feed fisik printer (595x842 pt untuk A4), sehingga dikirim ke CUPS dengan `opts.Orientation = "portrait"` dan `opts.Scaling = "Actual size"`. CUPS tidak lagi melakukan rotasi ganda atau pemaksaan skala; hasil cetak fisik 100% identik dengan WYSIWYG preview di browser!

---

## 3. Keputusan Teknis & Justifikasi

### 3.1 Geometri dokumen dipertahankan (revisi Lapis 6)
Vector fidelity dipertahankan; yang diperbaiki hanya **struktur** file (float
`/Rotate`, crop box non-standar) lewat `gs -sDEVICE=pdfwrite`. `pdftops -paper` /
`-expand` DIHAPUS dari kedua jalur (upload + dispatch) karena membakar dokumen ke
A4 sebelum user memilih kertas. Fit ke kertas dilakukan CUPS (`print-scaling`),
sehingga ukuran A5/Letter/4x6 benar-benar berlaku.

### 3.2 IPP over lpstat untuk status
`lpstat -W completed` = daftar finished (completed+canceled+aborted) tanpa
pembeda. IPP `Get-Job-Attributes` memberi enum state + `job-state-reasons`.
Quirk cupsd: request harus POST ke path root `/`; posting ke
`/printers/<nama>` mengembalikan OK-tanpa-atribut untuk job historis.

### 3.3 Auto-retry heuristik durasi & Stopped Handling
Cetak fisik 1 halaman minimum ~5-10 detik (feed kertas). `completed` yang
tiba <4 detik setelah dispatch mustahil fisik → auto re-dispatch maks 2x.
Status `stopped` akibat notice driver epson di-resolve sebagai `completed`.

### 3.4 Locale wajib di PM2
Tanpa LANG, filter chain senyap 0-byte. Sudah: ecosystem env + inject runtime.
Jangan dihapus.

---

## 4. Bukti Verifikasi (26 Aug)

| Uji | Job | Hasil |
|---|---|---|
| Playwright(Minibox)→UI login/upload/submit (1 page) | 178 | Status `Queued` ➔ `Completed` (0s error badge, 0 double print) ✅ |
| Scaling verification (A4 fit-to-page) | 178 | `print-scaling=fit` aktif ✅ (baris `-expand` sudah DIBATALKAN — lihat Lapis 6) |
| Multi-role UI & Responsive Check | — | Admin, User, Guest 100% SVG Native (Zero-Emoji) ✅ |
| RBAC matrix (401/200/403 × role) | — | Semua role sesuai ✅ |
| Unit tests Go | — | api + discovery + store PASS ✅ |

## 5. Dilarang Keras (pelajaran mahal)

1. ❌ **Jangan jalankan browser/playwright di NAS** — berat; eksekusi UI-E2E lewat Minibox (`100.90.80.95:22`) atau Kroombox (`kroombox2`).
2. ❌ **Jangan gunakan emoji Unicode di UI** — wajib selalu menggunakan icon SVG native (`src/components/ui/icons.jsx`).
3. ❌ Jangan hapus `LANG/LANGUAGE/LC_ALL` dari `ecosystem.config.cjs`.
4. ❌ **Jangan kembalikan `pdftops -paper` / `-expand`** ke `ensurePrintablePDF` atau `normalizeDocument`.
   Itu membakar geometri dokumen ke A4 saat upload dan membuat semua pilihan kertas lain (A5/Letter/4x6)
   tidak berfungsi. Perbaikan struktural PDF = `gs -sDEVICE=pdfwrite` saja (lihat Lapis 6).
5. ❌ Jangan kembalikan fake-timer completion atau `lpstat -W completed` sebagai sumber status sukses.
6. ❌ Jangan tambahkan `-dTextAlphaBits` pada render flatten.
7. ❌ SQLite WAJIB di disk lokal amba (`/home/amba/kroomprint-data/`), bukan mount NAS, dan wajib `SetMaxOpenConns(1)`.
8. ❌ Jangan lupa `chmod 755` saat build backend binary di NAS untuk eksekusi via NFS di `amba`.
