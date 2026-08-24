# SECURITY AUDIT REPORT — KroomPrint (printer-wireless)
**Methodology:** OWASP Top 10 2021 + OWASP API Security Top 10 + Playwright E2E Verification  
**Date:** 2026-08-24  
**Auditor:** Antigravity Red Team & QA Subsystem  

---

## 📋 Executive Summary
Audit keamanan mendalam telah dilakukan terhadap seluruh lapisan aplikasi **KroomPrint** (Go Backend REST API, SQLite Storage Engine, Remote CUPS/SSH Driver Subsystem, dan React 19 Frontend) yang diuji secara *live* menggunakan **Playwright Chromium Headless di Server Minibox (`100.90.80.95`)**.

**Status Keamanan:**
* Arsitektur backend Go sangat efisien dan aman dari SQL Injection (menggunakan parameterized queries).
* Ditemukan **kebocoran data sensitif dokumen cetak publik (Directory Listing)** dan **ketiadaan otentikasi server-side pada seluruh REST API endpoint** yang memungkinkan siapa saja di jaringan internal melihat seluruh dokumen, memanipulasi antrean cetak, serta mengubah pengaturan printer tanpa otorisasi.

---

## 🔍 Daftar Temuan Kerentanan (Findings)

### 🔴 [CRITICAL] VULN-001: Sensitive Data Exposure via Directory Listing pada `/uploads/`
* **File:** `backend/internal/api/server.go` (baris 278)
* **Kategori:** OWASP A01:2021 — Broken Access Control & OWASP A05:2021 — Security Misconfiguration
* **Bukti Pengujian (Playwright Minibox):**
  Request `GET http://100.90.80.85:8088/uploads/` mengembalikan status `200 OK` dengan format HTML directory index.
* **Skenario Risiko:**
  Standar `http.FileServer(http.Dir(UploadsDir))` di Go menyajikan daftar berkas secara publik jika tidak ada berkas `index.html`. Siapapun di jaringan dapat membuka URL `/uploads/`, melihat seluruh daftar PDF/foto/dokumen rahasia yang pernah diunggah oleh semua user, dan mengunduhnya secara bebas.
* **Potongan Kode:**
  ```go
  mux.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(s.cfg.UploadsDir))))
  ```
* **Solusi Perbaikan:**
  Nonaktifkan listing direktori dengan custom handler atau tolak request langsung ke root `/uploads/`, serta batasi akses download hanya untuk berkas dengan ID job yang valid.

---

### 🟠 [HIGH] VULN-002: Unauthenticated Public REST API Endpoints
* **File:** `backend/internal/api/server.go` (baris 236–276)
* **Kategori:** OWASP A07:2021 — Identification and Authentication Failures / API2:2023 Broken Authentication
* **Skenario Risiko:**
  Seluruh endpoint (`/api/printers`, `/api/jobs`, `/api/discovery/*`, `/api/settings`) tidak memiliki middleware otentikasi (JWT / Bearer token / API Key / Session cookie). Siapapun di jaringan LAN / ZeroTier dapat mengirimkan ribuan print job, membatalkan antrean orang lain, mengganti nama printer, atau memicu DoS hardware tanpa login.
* **Potongan Kode:**
  ```go
  mux.HandleFunc("POST /api/jobs", s.handleCreateJob)
  mux.HandleFunc("POST /api/printers", s.handleAddPrinter)
  mux.HandleFunc("DELETE /api/jobs", s.handleClearJobs)
  mux.HandleFunc("PUT /api/settings", s.handlePutSettings)
  ```
* **Solusi Perbaikan:**
  Terapkan middleware `requireAuth` di backend Go yang memvalidasi header `Authorization: Bearer <token>` atau Session API Token.

---

### 🟡 [MEDIUM] VULN-003: Client-Side Only Authentication Bypass
* **File:** `src/App.jsx` (baris 17–23) & `src/components/pages/LoginPage.jsx`
* **Kategori:** OWASP A01:2021 — Broken Access Control
* **Skenario Risiko:**
  Otentikasi hanya berupa *gate* visual di browser dengan mengecek `localStorage.getItem('kroomprint_session') === '1'`. Siapapun dapat melewati layar login dalam 1 baris kode di DevTools Console (`localStorage.setItem('kroomprint_session', '1'); location.reload()`) tanpa kredensial valid yang diverifikasi ke backend.
* **Potongan Kode:**
  ```javascript
  const [loggedIn, setLoggedIn] = useState(() => localStorage.getItem('kroomprint_session') === '1')
  ```
* **Solusi Perbaikan:**
  Buat endpoint backend `POST /api/auth/login` yang memverifikasi password / PIN admin dan mengembalikan signed JWT token yang disimpan dengan aman.

---

### 🟡 [MEDIUM] VULN-004: Ketiadaan Rate Limiting & Unrestricted Print Spooling DoS
* **File:** `backend/internal/api/server.go` (baris 990–1060)
* **Kategori:** OWASP A04:2021 — Insecure Design & API4:2023 Unrestricted Resource Consumption
* **Skenario Risiko:**
  Tidak ada batasan frekuensi request (*rate limiting*) atau kuota cetak per IP/klien. Penyerang dapat mengirim ribuan request upload multipart 32MB secara simultan atau mencetak 999 lembar terus-menerus hingga kertas/tinta printer fisik terkuras dan disk penuh (*disk exhaustion*).
* **Solusi Perbaikan:**
  1. Pasang token bucket rate limiter (misal: 10 request/menit per IP).
  2. Batasi maksimal copies default (misal: 20 lembar) kecuali dengan izin admin.
  3. Pasang cron pembersih otomatis untuk berkas di folder `/uploads/` yang sudah selesai dicetak.

---

### 🔵 [LOW] VULN-005: Missing Security Headers (CSP, X-Frame-Options, HSTS)
* **File:** `server.cjs` & `backend/internal/api/server.go`
* **Kategori:** OWASP A05:2021 — Security Misconfiguration
* **Skenario Risiko:**
  Static server dan API belum menyertakan header keamanan modern seperti `X-Frame-Options: DENY` (mencegah Clickjacking) dan `X-Content-Type-Options: nosniff`.

---

## 📊 Statistik Audit & Hasil Playwright E2E

```text
🔴 Critical : 1  (Directory Listing Exposure pada /uploads/)
🟠 High     : 1  (Unauthenticated Public REST API)
🟡 Medium   : 2  (Client-Side Auth Bypass & Unrestricted Print DoS)
🔵 Low/Info : 1  (Missing Security Headers)
────────────────────────────────────────────────────────────────────────
✅ Lulus Uji Fungsional & E2E di Minibox:
   - UI Rendering & Navigation : 100% LULUS (Dashboard, Printers, Print, Queue, History)
   - Printer Discovery & Status : 100% LULUS (Epson L3210 Online & Idle)
   - Console & Runtime Errors  : 0 Errors (Clean)
```
