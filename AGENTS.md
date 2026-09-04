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

#### Amba (CUPS Host & Production Runner)
- **Host:** `amba` (ZeroTier IP: `100.90.80.85` / LAN: `192.168.138.60`)
- **Credentials:** User `amba`, password `kolab777`
- **Runner:** PM2 (Name: `kroomprint-api`, executing `/mnt/web/Nouvem/printer-wireless/backend/kroomprint-backend` via NFS mount).
- **Binary Permissions:** File binary di NAS wajib memiliki izin `chmod 755` agar dapat dieksekusi oleh user `amba` melalui NFS mount.
- **Fungsi Utama:** Menerima file upload dari frontend, melakukan konversi/pemrosesan (Go backend), dan mendispatch print job ke daemon lokal CUPS via native IPP & fallback `lp`.
- **SQLite produksi:** `/home/amba/kroomprint-data/kroomprint.db` (disk LOKAL amba — WAJIB; SQLite di mount NAS menyebabkan segfault/lock contention). Driver `modernc.org/sqlite` dikonfigurasi dengan `SetMaxOpenConns(1)` + PRAGMA WAL/busy_timeout.
- **Auth:** RBAC multi-role aktif (admin/user/guest). Publik penuh: `GET /api/health` & `POST /api/auth/login`. Guest read-only via `optAuth` (baca printers/jobs/history/settings, SSE, diagnostics). Mutasi cetak wajib staff (`admin`/`user`): `POST /api/jobs`, cancel/pause/resume/retry/release, test-print, `PUT /api/settings`. Admin eksklusif: kelola printer/users/discovery, reset data, test-cups, clear history, `/uploads`. Token HMAC-SHA256 12-jam. Seed default: `admin/admin123`.

### Minibox / Kroombox (Browser E2E / UI Automation)
- **Minibox Host:** ZeroTier `100.90.80.95:22` (user `minibox`, pass `kolab777`)
- **Kroombox Host (SSH alias):** `kroombox2` (HostName `sshpcserver.kolab.top`, user `kroombox`) — key-based.
- **Gunakan untuk:** semua kebutuhan Playwright/automation UI. Playwright script directory: `/home/minibox/e2e-tests/` dengan browser args `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`.
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
4. **Penanganan False Failure CUPS (`stopped: job-completed-with-errors`):** Filter driver Epson mengeluarkan sinyal notice stderr non-fatal saat mentransfer byte terakhir ke USB. Status `stopped` dengan reason `job-completed-with-errors` dihitung sebagai **`completed`** oleh backend, bukan failed. Ini mencegah UI memunculkan status gagal palsu dan mencegah user melakukan *Retry* yang memicu *double print*.
5. **Fit to Page & Scaling A4:** Dokumen yang lebih kecil dari ukuran kertas A4 wajib diekspansi secara proporsional menggunakan flag `-expand` pada `pdftops` serta atribut IPP `print-scaling=fit` / `fitplot=true` agar tidak tercetak kecil di tengah kertas.

### Frontend UI, Auth & History Isolation
1. **Unauthenticated Default (Guest Mode):** Aplikasi tidak lagi memblokir akses pengguna awal dengan login wall layar penuh. Pengunjung tanpa token langsung memuat App Shell dalam role `guest` dan dapat memantau status Dashboard, Daftar Printer, Antrian (Queue), Riwayat, dan Print Studio secara read-only.
2. **Action Interception (Login Modal):** Ketika pengguna `guest` melakukan aksi protektif (drag/drop dokumen ke area Print Studio, klik tombol browse, scan kamera, atau klik Sign in), sistem menampilkan `LoginModal` (Bugster Glassmorphism style) tanpa reload halaman. Setelah sign in berhasil, pengguna dapat langsung melanjutkan proses cetak.
3. **Isolasi Riwayat Cetak (Per-User History):**
   - Riwayat cetak (`GET /api/history`) terisolasi per akun user (`WHERE user = ?`).
   - Akun non-admin (Standard User) hanya dapat melihat riwayat dokumen miliknya sendiri.
   - Akun Admin secara default melihat riwayat pribadinya (`My Prints`), serta disediakan switcher khusus `All Users (Audit)` untuk memantau log audit lengkap seluruh organisasi.
   - Pengunjung `guest` mendapatkan tampilan hero card edukatif untuk login dan tidak dapat mengakses data riwayat pengguna lain.
4. **Konfigurasi Halaman Settings (7 Fitur Utama & Adaptasi Role):**
   - **Diagnostics**: Terbuka untuk semua role (`GET /api/diagnostics/network` via `optAuth`). Mengukur real-time latency socket CUPS, Gateway, Spool Storage, dan seluruh printer terdaftar.
   - **CUPS Server & Remote Connectivity**: Admin dapat mengedit URL CUPS dan melakukan live TCP ping test (`POST /api/settings/test-cups`). Standard User & Guest melihat status live "Connected".
   - **Account & Workspace**: Menampilkan identitas user (`IconCrown` untuk Admin, `IconUser` untuk Standard User, `IconEye` untuk Guest). Modal *Change Password* (`POST /api/auth/change-password`) aktif untuk user terotentikasi. *Danger Zone* (Reset All Data) dikunci eksklusif untuk Admin.
   - **Compact Queue View**: Toggle `settings.compactQueue` mengubah tampilan antrian di `QueuePage` menjadi format tabel berdensitas tinggi dengan switcher instan di header.
   - **Dark Mode (Glassmorphism Dark)**: Sinkronisasi real-time via CSS variables di `index.css` (`html.dark`) dan `settings.darkMode`.
   - **Job Notifications**: Terintegrasi dengan Web Notification API native browser (`Notification.requestPermission()`) dan in-app toasts.
   - **Auto-Refresh**: Mengontrol cadence polling background secara dinamis.
5. **Zero-Emoji Compliance:** DILARANG KERAS menggunakan karakter emoji Unicode (`❌`, `👑`, `👤`, `👁️`, `🔒`, `⚠️`, `✓`, `✕`, `🗑️`, dll.) di seluruh komponen UI.
6. **Mandatory Native SVG Icons:** Semua icon dan visual badge wajib menggunakan komponen SVG stroke native yang selaras dengan Bugster Design System (diekspor dari `src/components/ui/icons.jsx`).
7. **User Avatars & Logos:** Avatar pengguna menggunakan kontainer rounded square geometris (`rounded-[11px] border-2 border-dark-black-900`) dengan icon SVG role (`IconCrown` untuk Admin, `IconUser` untuk Standard User, `IconEye` untuk Guest).

### PM2 & Eksekusi Node/Go
- Log backend Go (di `amba`):
  - Out: `/home/amba/.pm2/logs/kroomprint-api-out.log`
  - Error: `/home/amba/.pm2/logs/kroomprint-api-error.log`
- Saat me-rebuild backend Go, selalu pastikan menggunakan flag `-buildvcs=false` jika dijalankan dalam folder yang sedang dimount dari jaringan (NAS) untuk menghindari error VCS status.
- **Locale Wajib di PM2 (LANG):** Proses spawn PM2 **tanpa LANG** membuat filter chain CUPS menghasilkan `Sent 0 bytes` secara SILENT sementara CUPS melaporkan job sukses (~50% gagal "acak").
  - **Solusi:** `ecosystem.config.cjs` memuat `LANG/LANGUAGE/LC_ALL` + belt-and-suspenders inject env di `dispatchPrintJob`. **Dilarang hapus** saat cleanup env.
- **PDF Vector Normalization:** Normalisasi dokumen via Poppler `pdftops -level3 -paper A4 -expand` + Ghostscript pdfwrite `ensurePrintablePDF`.
- **Status Job = IPP Authoritative:** Status sukses/gagal dibaca via `GetJobStateIPP` (discovery/jobstate.go).
- **RBAC:** Role enum `admin|user|guest`; matriks izin lengkap ada di `docs/PRINTING_PIPELINE.md` dan kode `Handler()`. Guest read-only; user boleh cetak; admin penuh + manajemen users.

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
