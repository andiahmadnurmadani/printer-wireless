# AGENTS.md — KroomPrint (printer-wireless)

> Dibaca otomatis oleh Antigravity CLI (`agy`) atau AI assistant lain di awal setiap sesi.
> File ini adalah **titik masuk (entrypoint) utama** untuk memahami arsitektur, environment, dan aturan main project KroomPrint.

**Project:** KroomPrint · Wireless Printer Panel SaaS
**Stack Frontend:** React + Vite (Port `5174` dev)
**Stack Backend:** Go + SQLite + CUPS Print Spooler (Port `8088` dev)
**Root NAS:** `/volume1/web/Nouvem/printer-wireless`

---

## 1. Arsitektur Server & Host Environment

Project ini berjalan terpisah antara storage/development (Synology NAS) dan eksekusi hardware printing (CUPS host).

### NAS (Development & Storage)
- **Path:** `/volume1/web/Nouvem/printer-wireless`
- **Frontend Build:** `npm run build` -> menghasilkan direktori `dist/`
- **Backend Build:** `cd backend && go build -buildvcs=false -o kroomprint-backend .`

### Amba (CUPS Host & Production Runner)
- **Host:** `amba` (ZeroTier IP: `100.90.80.85` / LAN: `192.168.138.60`)
- **Credentials:** User `amba`, password `kolab777`
- **Runner:** PM2 (Name: `kroomprint-api`; ID bisa berubah setelah delete/start — selalu cek `pm2 ls`)
- **Fungsi Utama:** Menerima file upload dari frontend, melakukan konversi/pemrosesan (Go backend), dan mendispatch print job ke daemon lokal CUPS via binary `lp`.
- **SQLite produksi:** `/home/amba/kroomprint-data/kroomprint.db` (disk LOKAL amba — WAJIB; SQLite di mount NAS menyebabkan segfault berulang).
- **Auth:** RBAC multi-role aktif (admin/user/guest). Semua endpoint kecuali `GET /api/health` & `POST /api/auth/login` wajib Bearer token. Seed default: `admin/admin123`.

### Kroombox (Browser E2E / UI Automation)
- **SSH alias:** `kroombox2` (HostName `sshpcserver.kolab.top`, user `kroombox`) — key-based.
- **Gunakan untuk:** semua kebutuhan Playwright/automation UI. Setup siap pakai: `~/kp-e2e` (playwright + chromium headless).
- **DILARANG KERAS** menjalankan browser/playwright di NAS (berat; cache sudah di-uninstall).

---

## 2. Aturan Operasional Kritis (Guardrails)

### CUPS & Hardware Printing (Epson L3210)
1. **Konflik Kernel `usblp`:** Daemon CUPS (via `libusb`) akan gagal berkomunikasi dengan printer fisik Epson L3210 jika modul kernel `usblp` sedang di-load oleh sistem.
   - **Solusi:** Modul `usblp` **wajib** di-blacklist secara permanen di `amba` (`/etc/modprobe.d/blacklist-usblp.conf`).
2. **Monochrome Print Flag:** Untuk printer Epson ESC/P-R (seperti L3210), mencetak dokumen monochrome **harus** menggunakan opsi `-o Ink=MONO` pada perintah `lp`.
   - Menggunakan `-o print-color-mode=monochrome` atau `ColorModel=Gray` akan menghasilkan halaman kosong karena format raster tidak dapat didekode oleh filter epson.
3. **Pencegahan Stuck Queue (Pre-flight):** Jika ada print job berupa raw text (misal hasil echo ke `lp`) yang tersangkut di queue, CUPS akan mem-block *semua* job PDF selanjutnya yang valid.
   - **Solusi Kode:** Backend Go **selalu** menjalankan `cancel -a <printer>`, `cupsenable <printer>`, dan `cupsaccept <printer>` tepat sebelum mendispatch job baru ke local `lp`.

### PM2 & Eksekusi Node/Go
- Log backend Go (di `amba`):
  - Out: `/home/amba/.pm2/logs/kroomprint-api-out.log`
  - Error: `/home/amba/.pm2/logs/kroomprint-api-error.log`
- Saat me-rebuild backend Go, selalu pastikan menggunakan flag `-buildvcs=false` jika dijalankan dalam folder yang sedang dimount dari jaringan (NAS) untuk menghindari error VCS status.
4. **Locale Wajib di PM2 (LANG):** Proses spawn PM2 **tanpa LANG** membuat filter chain CUPS menghasilkan `Sent 0 bytes` secara SILENT sementara CUPS melaporkan job sukses (~50% gagal "acak").
   - **Solusi:** `ecosystem.config.cjs` memuat `LANG/LANGUAGE/LC_ALL` + belt-and-suspenders inject env di `dispatchPrintJob`. **Dilarang hapus** saat cleanup env.
5. **PDF Flatten Pipeline:** Semua PDF ≤32MB otomatis dirasterize (`ensurePrintablePDF`: IM convert → gs render PNG 300dpi tanpa-AA → level boost) sebelum spool, karena invoice producer membawa `/Rotate` float & crop-box rusak yang membuat pdftopdf crash/halaman kosong. Jangan tambahkan `-dTextAlphaBits` (membuat teks hilang) dan jangan kembalikan pass-through vector.
6. **Status Job = IPP Authoritative:** Status sukses/gagal dibaca via `GetJobStateIPP` (discovery/jobstate.go), bukan kehadiran di `lpstat -W completed` (daftar itu mencampur aborted). Fake-timer completion telah DIHAPUS — jangan dihidupkan ulang.
7. **RBAC:** Role enum `admin|user|guest`; matriks izin lengkap ada di `docs/PRINTING_PIPELINE.md` dan kode `Handler()`. Guest read-only; user boleh cetak; admin penuh + manajemen users.

> 📚 **Dokumentasi mendalam pipeline cetak, kronologi debugging 5-lapis, dan troubleshooting:** [`docs/PRINTING_PIPELINE.md`](docs/PRINTING_PIPELINE.md)

---

## 3. Workflow & Debugging SSH

- Jika agents membutuhkan akses terminal ke `amba` untuk mengecek status CUPS, gunakan timeout yang cukup (`readyTimeout: 30000` di Node.js SSH client) untuk mengkompensasi latency awal ZeroTier.
- **Perintah Diagnostik Berguna di Amba:**
  - `lpstat -p` (Status printer)
  - `lpstat -o` (Status antrian / jobs)
  - `lpstat -W completed` (Riwayat jobs selesai — **ingat: mencampur aborted, bukan bukti sukses**)
  - `echo kolab777 | sudo -S tail -n 50 /var/log/cups/error_log` (Melihat aktivitas filter chain CUPS: `pdftopdf`, `ghostscript`, `epson-escpr-wrapper`, `usb`)
  - **Metrik penentu keberhasilan fisik:** `grep "Sent [0-9]+ bytes"` untuk job terkait — `Sent 0 bytes` = gagal senyap meski CUPS bilang completed.
  - Status job authoritative: fungsi `GetJobStateIPP` (discovery/jobstate.go) — lihat `docs/PRINTING_PIPELINE.md` §2 Lapis 3.

---

## 4. Alur Integrasi (E2E)
- **Frontend** mengirim request ke Backend (`/api/jobs`).
- **Backend (Go)** menyimpan status job di SQLite, mendownload/memvalidasi file.
- **Backend (Go)** menjalankan command lokal `lp` (pada environment `amba`).
- **CUPS** di `amba` memproses file melalui filter chain dan mengirim via USB ke printer fisik.
- **Backend** memantau status CUPS dan mem-broadcast update via Server-Sent Events (SSE) ke frontend secara real-time.
