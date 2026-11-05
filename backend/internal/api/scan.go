package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Flatbed scan from a USB printer attached to this host (e.g. Epson L3210, no ADF).
// One request = one sheet. Pages accumulate per session under uploads/scans/<session>/
// and every response returns the merged PDF of all pages scanned so far.

type scanReq struct {
	PrinterID  string `json:"printerId"`
	SessionID  string `json:"sessionId"`
	Resolution int    `json:"resolution"`
	Mode       string `json:"mode"` // color | gray | bw
}

var scanModes = map[string]string{"color": "Color", "gray": "Gray", "bw": "Lineart"}

// validate normalizes the request; returns the SANE mode name.
func (q *scanReq) validate() (string, error) {
	if q.Resolution == 0 {
		q.Resolution = 300
	}
	switch q.Resolution {
	case 75, 150, 300, 600:
	default:
		return "", fmt.Errorf("resolusi harus 75, 150, 300, atau 600")
	}
	if q.Mode == "" {
		q.Mode = "color"
	}
	mode, ok := scanModes[q.Mode]
	if !ok {
		return "", fmt.Errorf("mode harus color, gray, atau bw")
	}
	if q.SessionID == "" {
		q.SessionID = uuid.NewString()
	} else if _, err := uuid.Parse(q.SessionID); err != nil {
		return "", fmt.Errorf("sessionId tidak valid")
	}
	return mode, nil
}

func (s *Server) handlePrinterScan(w http.ResponseWriter, r *http.Request) {
	var req scanReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	mode, err := req.validate()
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	p, err := s.store.GetPrinter(req.PrinterID)
	if err != nil {
		writeErr(w, 404, "printer tidak ditemukan")
		return
	}

	// Same per-printer lock as print dispatch: no scan while a job is being spooled, and
	// a print waits until the scan finishes. CUPS "printing" covers jobs already spooled.
	mu := s.getPrinterMutex(p.ID)
	if !mu.TryLock() {
		writeErr(w, 409, "printer sedang memproses cetakan, coba lagi sebentar")
		return
	}
	defer mu.Unlock()
	if lpstat, err := exec.LookPath("lpstat"); err == nil {
		if out, _ := exec.Command(lpstat, "-p", cupsPrinterName(p)).Output(); strings.Contains(string(out), "printing") {
			writeErr(w, 409, "printer sedang mencetak, tunggu sampai selesai")
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Minute)
	defer cancel()

	// ponytail: first SANE device wins; add a per-printer device mapping when >1 scanner is attached.
	out, err := exec.CommandContext(ctx, "scanimage", "-f", "%d%n", "-L").Output()
	device := strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
	if err != nil || device == "" {
		writeErr(w, 503, "scanner tidak terdeteksi (cek kabel USB / printer menyala)")
		return
	}

	scansRoot := filepath.Join(s.cfg.UploadsDir, "scans")
	pruneOldScans(scansRoot, time.Hour)
	dir := filepath.Join(scansRoot, req.SessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	pages, _ := filepath.Glob(filepath.Join(dir, "*.png"))
	if len(pages) >= 50 {
		writeErr(w, 400, "maksimal 50 halaman per dokumen scan")
		return
	}
	pagePath := filepath.Join(dir, fmt.Sprintf("%03d-%d.png", len(pages)+1, req.Resolution))

	start := time.Now()
	cmd := exec.CommandContext(ctx, "scanimage", "-d", device, "--mode", mode,
		"--resolution", strconv.Itoa(req.Resolution), "--format=png", "-o", pagePath)
	if b, err := cmd.CombinedOutput(); err != nil {
		os.Remove(pagePath)
		s.log.Printf("scan failed (%s): %v %s", device, err, b)
		writeErr(w, 500, "scan gagal: "+strings.TrimSpace(string(b)))
		return
	}
	s.log.Printf("scan page %s ok (%s %ddpi, %s)", pagePath, mode, req.Resolution, time.Since(start).Round(time.Second))

	// Convert only the new page (each at its own dpi so the page keeps the physical glass
	// size), then merge all per-page PDFs with pdfunite.
	pageArgs := []string{"-units", "PixelsPerInch", "-density", strconv.Itoa(req.Resolution), pagePath}
	if mode != "Lineart" {
		pageArgs = append(pageArgs, "-compress", "jpeg", "-quality", "85")
	}
	pagePDF := strings.TrimSuffix(pagePath, ".png") + ".pdf"
	if b, err := exec.CommandContext(ctx, "convert", append(pageArgs, pagePDF)...).CombinedOutput(); err != nil {
		os.Remove(pagePath)
		writeErr(w, 500, "gagal membuat PDF: "+strings.TrimSpace(string(b)))
		return
	}

	pages, _ = filepath.Glob(filepath.Join(dir, "[0-9][0-9][0-9]-*.pdf"))
	sort.Strings(pages)
	pdfPath := filepath.Join(dir, "scan.pdf")
	if len(pages) == 1 {
		pdfPath = pages[0]
	} else if b, err := exec.CommandContext(ctx, "pdfunite", append(pages, pdfPath)...).CombinedOutput(); err != nil {
		writeErr(w, 500, "gagal menggabung PDF: "+strings.TrimSpace(string(b)))
		return
	}

	w.Header().Set("X-Scan-Session", req.SessionID)
	w.Header().Set("X-Scan-Pages", strconv.Itoa(len(pages)))
	w.Header().Set("Access-Control-Expose-Headers", "X-Scan-Session, X-Scan-Pages")
	w.Header().Set("Content-Type", "application/pdf")
	http.ServeFile(w, r, pdfPath)
}

// pruneOldScans removes scan sessions untouched for longer than maxAge.
func pruneOldScans(root string, maxAge time.Duration) {
	entries, _ := os.ReadDir(root)
	for _, e := range entries {
		if fi, err := e.Info(); err == nil && e.IsDir() && time.Since(fi.ModTime()) > maxAge {
			os.RemoveAll(filepath.Join(root, e.Name()))
		}
	}
}
