# KroomPrint — Pipeline Cetak & Riwayat Debugging Produksi

> Dokumen teknis resmi pipeline pencetakan KroomPrint. Ditulis setelah sesi
> live-fire debugging 26 Agustus 2026 yang mengungkap **5 lapis masalah
> berlapis** pada jalur cetak PDF. Wajib dibaca sebelum menyentuh
> `dispatchPrintJob`, `normalizeDocument`, `pdfToPageImages`, atau
> `syncCupsJobStatus`.

---

## 1. Arsitektur Pipeline Cetak (Kondisi Saat Ini)

```
UI Upload (multipart POST /api/jobs)
  │
  ├─[upload-time] ensurePrintablePDF(dst)          ← server.go handleCreateJob
  │    IM convert -density 200 → ras.pdf (image-PDF flat)
  │
  └─ respond 201 segera; async:
       dispatchPrintJob(jobID, filePath, req, printer, name)
         │ per-printer MUTEX (anti device-busy collision)
         │ pre-flight: cancel -a / cupsenable / cupsaccept
         │
         ├─ pdfToPageImages(filePath, gray)          ← server.go
         │    gs -sDEVICE=png{16m|gray} -r300        ← TANPA antialias!
         │    + convert p-XX.png -level 55%,97%      ← contrast boost
         │
         └─ lp -d <queue> -o media=A4 -o Ink=MONO [PNG pages...]
              │ (env LANG wajib — lihat §3.4)
              ▼
            CUPS: universal → imagetoraster → epson-escpr-wrapper → usb
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
| `ensurePrintablePDF` | api/server.go | Gerbang tunggal normalisasi PDF (IM rasterize ≤32MB) |
| `rasterizePDFRepair` | api/server.go | Eksekusi `convert -density 200` image-PDF |
| `pdfToPageImages` | api/server.go | Render halaman → PNG 300dpi tanpa-AA + level boost |
| `pdfHasFloatRotate` | api/server.go | Scan byte `/Rotate <float>` (hanya untuk VERIFIKASI, bukan gerbang) |
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

### Bonus — teks hilang, garis tabel muncul (26 Aug pagi)
Render gs dengan `-dTextAlphaBits=4` menghasilkan tepi glyph antialias
abu-abu → jatuh di bawah tone threshold driver ESC/P-R → huruf "tercuci",
garis solid hitam lolos. **Fix** (`0e54f09`): render 300dpi TANPA flag AA +
contrast push `-level 55%,97%`.

---

## 3. Keputusan Teknis & Justifikasi

### 3.1 Rasterize-by-default untuk semua PDF
Vector fidelity dikorbankan demi kepastian pengiriman. Dua insiden membuktikan
struktural-fix tidak cukup (rotate + crop-box sekaligus). Raster 200dpi
(image-PDF) dan 300dpi (page-PNG) terbukti fisik tercetak.

### 3.2 IPP over lpstat untuk status
`lpstat -W completed` = daftar finished (completed+canceled+aborted) tanpa
pembeda. IPP `Get-Job-Attributes` memberi enum state + `job-state-reasons`.
Quirk cupsd: request harus POST ke path root `/`; posting ke
`/printers/<nama>` mengembalikan OK-tanpa-atribut untuk job historis.

### 3.3 Auto-retry heuristik durasi
Cetak fisik 1 halaman minimum ~5-10 detik (feed kertas). `completed` yang
tiba <4 detik setelah dispatch mustahil fisik → auto re-dispatch maks 2x.
Konstanta: `fastCompleteSuspicionMs=4000`, `maxFastCompleteRetries=2`.

### 3.4 Locale wajib di PM2
Tanpa LANG, filter chain senyap 0-byte. Sudah: ecosystem env + inject runtime.
Jangan dihapus.

---

## 4. Bukti Verifikasi (26 Aug)

| Uji | Job | Hasil |
|---|---|---|
| Playwright(kroombox)→UI login/upload/submit | 104 | `Sent 1,537,142 bytes` ✅ fisik |
| Auto-retry tersedia | — | logika ter-deploy, menunggu kasus nyata |
| RBAC matrix (401/200/403 × role) | — | semua sesuai ✅ |
| Honest failed | 81 | `failed (stopped): job-completed-with-errors` ✅ |
| Unit tests Go | — | api+discovery+store PASS |
| Halaman teks 10 baris | 107 | tercetak penuh (konfirmasi user) ✅ |

## 5. STATUS TERBUKA (per dokumentasi ini)

**Job 113** (`1adee5f4`, cupsJobId=113, 10:19): backend melaporkan
`completed` + data terkirim, **namun kertas belum teramati keluar** oleh user
pada penulisan dokumen ini. Kemungkinan: (a) printer masih buffering/proses,
(b) gejala wash-out belum tertangani penuh, (c) paper jam senyap.

**Langkah verifikasi berikutnya (urut):**
1. Cek fisik printer: lampu status, ada kertas macet?
2. `lpstat -o` — job masih aktif? `lpstat -W completed | tail` — masuk history?
3. Bandingkan `Sent N bytes` job 113 di error_log (N>500KB = data utuh).
4. Bila data utuh tapi blank: cetak ulang dengan mode bilevel murni
   (ganti level boost → `convert -monochrome`) — dijamin lolos threshold.
5. Bila masih gagal: uji nozzle check bawaan printer via panel (hardware).

## 6. Dilarang Keras (pelajaran mahal)

1. ❌ **Jangan jalankan browser/playwright di NAS** — berat; eksekusi UI-E2E
   lewat kroombox (ssh alias `kroombox2`, playwright+chromium terpasang di
   `~/kp-e2e`).
2. ❌ Jangan hapus `LANG/LANGUAGE/LC_ALL` dari `ecosystem.config.cjs`.
3. ❌ Jangan kembalikan fake-timer completion atau `lpstat -W completed`
   sebagai sumber status sukses.
4. ❌ Jangan tambahkan `-dTextAlphaBits` pada render flatten.
5. ❌ SQLite WAJIB di disk lokal amba (`/home/amba/kroomprint-data/`),
   bukan mount NAS.
