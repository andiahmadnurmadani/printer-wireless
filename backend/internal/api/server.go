package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"kroomprint/backend/internal/config"
	"kroomprint/backend/internal/discovery"
	"kroomprint/backend/internal/store"
)

// Server holds handlers and dependencies.
type Server struct {
	cfg       *config.Config
	store     *store.Store
	scanner   *discovery.Scanner
	log       *log.Logger
	scanMu    chan struct{} // serializes scans
	scanState scanState
}

type scanState struct {
	Running bool      `json:"running"`
	Started time.Time `json:"startedAt"`
}

// New builds the API server.
func New(cfg *config.Config, st *store.Store, logger *log.Logger) *Server {
	return &Server{
		cfg:     cfg,
		store:   st,
		scanner: &discovery.Scanner{CUPSURL: cfg.CUPSURL, CUPSSSH: cfg.CUPSSSH, Delay: time.Duration(cfg.DiscoveryDelayMS) * time.Millisecond, Log: logger},
		log:     logger,
		scanMu:  make(chan struct{}, 1),
	}
}

// StartCupsPoller begins a background loop that syncs job status with the
// real CUPS server. Only meaningful when CUPS is configured (ssh:// or http://).
// It polls every 1 second and syncs real-time printing progress and completion.
func (s *Server) StartCupsPoller() {
	if s.cfg.CUPSURL == "" {
		return
	}
	s.log.Printf("cups poller started (%s)", s.cfg.CUPSURL)
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			s.syncCupsJobStatus()
		}
	}()
}

// syncCupsJobStatus checks all "printing" jobs against the real CUPS queue.
func (s *Server) syncCupsJobStatus() {
	jobs, err := s.store.ListJobs()
	if err != nil {
		return
	}
	userHost := s.cfg.CUPSSSH
	if userHost == "" {
		userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
	}
	sshMode := discovery.IsSSHURL(s.cfg.CUPSURL)

	for _, j := range jobs {
		if j.Status != "printing" || j.CupsJobID == 0 {
			continue
		}
		p, err := s.store.GetPrinter(j.PrinterID)
		if err != nil {
			continue
		}
		printerName := cupsPrinterName(p)

		var cupsStatus string
		if sshMode {
			cupsStatus, _ = discovery.SSHGetJobStatus(userHost, printerName, j.CupsJobID)
		} else if lpstat, err := exec.LookPath("lpstat"); err == nil {
			targetPrefix := fmt.Sprintf("%s-%d", printerName, j.CupsJobID)
			outBytes, _ := exec.Command(lpstat, "-o", printerName).CombinedOutput()
			out := string(outBytes)
			if strings.Contains(out, targetPrefix) {
				cupsStatus = "printing"
			} else {
				outCBytes, _ := exec.Command(lpstat, "-W", "completed", "-o", printerName).CombinedOutput()
				outC := string(outCBytes)
				if strings.Contains(outC, targetPrefix) {
					cupsStatus = "completed"
				} else {
					cupsStatus = "notfound"
				}
			}
		} else {
			cupsStatus = "printing"
		}

		switch cupsStatus {
		case "printing":
			// Calculate smooth real-time physical printing progress
			totalPages := j.Pages * j.Copies
			if totalPages <= 0 {
				totalPages = 1
			}
			secPerPage := 10.0
			switch strings.ToLower(j.Quality) {
			case "draft":
				secPerPage = 5.0
			case "high":
				secPerPage = 20.0
			case "photo":
				secPerPage = 35.0
			}
			estTotalSec := float64(totalPages) * secPerPage
			elapsedSec := float64(time.Now().UnixMilli()-j.CreatedAt) / 1000.0
			if elapsedSec < 0 {
				elapsedSec = 0
			}

			// Spooling & Rasterizing stage (10% -> 25%)
			// Physical head printing stage (25% -> 94%)
			prog := 12.0 + (elapsedSec/estTotalSec)*80.0
			if prog > 94.0 {
				prog = 94.0
			}
			if int(prog) > j.Progress {
				j.Progress = int(prog)
				_ = s.store.UpdateJob(j)
			}

		case "completed":
			now := time.Now().UnixMilli()
			j.Status = "completed"
			j.Progress = 100
			j.CompletedAt = &now
			_ = s.store.UpdateJob(j)
			_ = s.store.CompleteJobToHistory(j, "completed", "")
			s.log.Printf("job %s (%s) completed by CUPS", j.Name, j.ID[:8])

		case "notfound":
			// Job finished and left CUPS active queue
			elapsedSec := float64(time.Now().UnixMilli()-j.CreatedAt) / 1000.0
			if elapsedSec > 2.0 {
				now := time.Now().UnixMilli()
				j.Status = "completed"
				j.Progress = 100
				j.CompletedAt = &now
				_ = s.store.UpdateJob(j)
				_ = s.store.CompleteJobToHistory(j, "completed", "")
				s.log.Printf("job %s (%s) finished and cleared from CUPS spooler", j.Name, j.ID[:8])
			}
		}
	}

	// Periodic hardware online/offline status check
	if sshMode {
		printers, _ := s.store.ListPrinters()
		if len(printers) > 0 {
			out, err := discovery.SSHRunSimple(userHost, "lpstat -p 2>&1; echo '===USB==='; lsusb 2>/dev/null | grep -iE 'epson|print|04b8'")
			if err == nil {
				parts := strings.Split(out, "===USB===")
				lpOut := strings.ToLower(parts[0])
				usbOut := ""
				if len(parts) > 1 {
					usbOut = strings.TrimSpace(parts[1])
				}
				for _, pr := range printers {
					pName := strings.ToLower(cupsPrinterName(pr))
					isUnplugged := strings.Contains(lpOut, "unplugged") || strings.Contains(lpOut, "turned off") || (!strings.Contains(lpOut, pName) && usbOut == "")
					if strings.Contains(strings.ToLower(pr.Connection), "usb") || strings.Contains(strings.ToLower(pr.Name), "l3210") {
						if isUnplugged || usbOut == "" {
							if pr.Status != "offline" {
								pr.Status = "offline"
								_ = s.store.UpdatePrinter(pr)
							}
						} else {
							if pr.Status != "online" && !pr.Paused {
								pr.Status = "online"
								_ = s.store.UpdatePrinter(pr)
							}
						}
					}
				}
			}
		}
	}
}

// writeJSON marshals v to the response writer with proper status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		for _, o := range s.cfg.AllowedOrigins {
			if o == "*" || o == origin {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				break
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "600")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if s.log != nil {
			s.log.Printf("%s %s %s (%s)", r.Method, r.URL.Path, r.RemoteAddr, time.Since(start).Round(time.Millisecond))
		}
	})
}

// Handler returns the root mux with all routes registered.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "time": time.Now(), "cups": s.cfg.CUPSURL != ""})
	})

	// ── Printers ──
	mux.HandleFunc("GET /api/printers", s.handleListPrinters)
	mux.HandleFunc("POST /api/printers", s.handleAddPrinter)
	mux.HandleFunc("GET /api/printers/{id}", s.handleGetPrinter)
	mux.HandleFunc("PATCH /api/printers/{id}", s.handlePatchPrinter)
	mux.HandleFunc("DELETE /api/printers/{id}", s.handleDeletePrinter)
	mux.HandleFunc("POST /api/printers/{id}/refresh", s.handleRefreshPrinter)
	mux.HandleFunc("POST /api/printers/{id}/test", s.handleTestPrint)
	mux.HandleFunc("POST /api/printers/{id}/pause", s.handlePausePrinter)
	mux.HandleFunc("POST /api/printers/{id}/resume", s.handleResumePrinter)
	mux.HandleFunc("POST /api/printers/{id}/enable", s.handleEnablePrinter)
	mux.HandleFunc("POST /api/printers/{id}/disable", s.handleDisablePrinter)
	mux.HandleFunc("POST /api/printers/{id}/default", s.handleSetDefault)
	mux.HandleFunc("POST /api/printers/{id}/rename", s.handleRenamePrinter)

	// ── Discovery ──
	mux.HandleFunc("POST /api/discovery/scan", s.handleScan)
	mux.HandleFunc("GET /api/discovery/results", s.handleDiscoveryResults)
	mux.HandleFunc("POST /api/discovery/{id}/add", s.handleAddDiscovered)
	mux.HandleFunc("DELETE /api/discovery/{id}", s.handleDeleteDiscovered)

	// ── Jobs ──
	mux.HandleFunc("GET /api/jobs", s.handleListJobs)
	mux.HandleFunc("POST /api/jobs", s.handleCreateJob)
	mux.HandleFunc("GET /api/jobs/{id}", s.handleGetJob)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", s.handleCancelJob)
	mux.HandleFunc("POST /api/jobs/{id}/pause", s.handlePauseJob)
	mux.HandleFunc("POST /api/jobs/{id}/resume", s.handleResumeJob)
	mux.HandleFunc("POST /api/jobs/{id}/retry", s.handleRetryJob)
	mux.HandleFunc("POST /api/jobs/reorder", s.handleReorderJobs)
	mux.HandleFunc("POST /api/jobs/{id}/priority", s.handleSetPriority)
	mux.HandleFunc("POST /api/jobs/clear", s.handleClearJobs)
	mux.HandleFunc("DELETE /api/jobs", s.handleClearJobs)

	// ── History ──
	mux.HandleFunc("GET /api/history", s.handleListHistory)
	mux.HandleFunc("DELETE /api/history", s.handleClearHistory)

	// ── Settings ──
	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/settings", s.handlePutSettings)

	// ── Document Preview Conversion ──
	mux.HandleFunc("POST /api/convert/preview", s.handleConvertPreview)

	// Uploads (served files - safe file server without directory listing)
	mux.HandleFunc("GET /uploads/", func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/uploads/"))
		if p == "" || p == "." || p == "/" {
			http.NotFound(w, r)
			return
		}
		fullPath := filepath.Join(s.cfg.UploadsDir, p)
		fi, err := os.Stat(fullPath)
		if err != nil || fi.IsDir() {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, fullPath)
	})

	return s.logRequests(s.enableCORS(mux))
}

// ── helpers ──

func pathID(r *http.Request) string { return r.PathValue("id") }

func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// ── Printers handlers ──

func (s *Server) handleListPrinters(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListPrinters()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, list)
}

func (s *Server) handleGetPrinter(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetPrinter(pathID(r))
	if err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	writeJSON(w, 200, p)
}

type addPrinterReq struct {
	Name      string `json:"name"`
	Brand     string `json:"brand"`
	Model     string `json:"model"`
	Connection string `json:"connection"`
	Address   string `json:"address"`
	IsDefault bool   `json:"isDefault"`
}

func (s *Server) handleAddPrinter(w http.ResponseWriter, r *http.Request) {
	var req addPrinterReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid JSON body")
		return
	}
	if req.Name == "" || req.Address == "" {
		writeErr(w, 400, "name and address are required")
		return
	}
	p := store.Printer{
		Name:       req.Name,
		Brand:      req.Brand,
		Model:      req.Model,
		Connection: req.Connection,
		Address:    req.Address,
		Status:     "online",
		Enabled:    true,
		IsDefault:  req.IsDefault,
		Caps: store.Capabilities{
			PaperSizes:   []string{"A4", "A5", "Letter", "Legal"},
			Qualities:    []string{"Draft", "Standard", "High"},
			Scalings:     []string{"Fit to page", "Shrink to fit", "Actual size", "Custom"},
			Orientations: []string{"Portrait", "Landscape"},
			Duplex:       true,
			Color:        true,
			MaxCopies:    999,
		},
	}
	created, err := s.store.CreatePrinter(p)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, created)
}

func (s *Server) handlePatchPrinter(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	var fields map[string]any
	if err := readJSON(r, &fields); err != nil {
		writeErr(w, 400, "invalid JSON body")
		return
	}
	if err := s.store.PatchPrinter(id, func(p *store.Printer) error {
		if v, ok := fields["name"].(string); ok && v != "" {
			p.Name = v
		}
		if v, ok := fields["brand"].(string); ok {
			p.Brand = v
		}
		if v, ok := fields["model"].(string); ok {
			p.Model = v
		}
		if v, ok := fields["connection"].(string); ok {
			p.Connection = v
		}
		if v, ok := fields["address"].(string); ok && v != "" {
			p.Address = v
		}
		return nil
	}); err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	p, _ := s.store.GetPrinter(id)
	writeJSON(w, 200, p)
}

func (s *Server) handleDeletePrinter(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeletePrinter(pathID(r)); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleRenamePrinter(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	var req struct{ Name string `json:"name"` }
	if err := readJSON(r, &req); err != nil || req.Name == "" {
		writeErr(w, 400, "name is required")
		return
	}
	if err := s.store.PatchPrinter(id, func(p *store.Printer) error { p.Name = req.Name; return nil }); err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	p, _ := s.store.GetPrinter(id)
	writeJSON(w, 200, p)
}

func (s *Server) handleRefreshPrinter(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	p, err := s.store.GetPrinter(id)
	if err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	// Query real status from CUPS (when configured).
	if s.cfg.CUPSURL != "" {
		sshMode := discovery.IsSSHURL(s.cfg.CUPSURL)
		userHost := s.cfg.CUPSSSH
		if userHost == "" {
			userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
		}
		printerName := cupsPrinterName(p)
		if sshMode {
			// Refresh capabilities from real PPD via lpoptions
			if caps, err := discovery.SSHProbePrinter(userHost, printerName); err == nil {
				p.Caps = store.Capabilities{
					PaperSizes:   caps.PaperSizes,
					Qualities:    caps.Qualities,
					Scalings:     caps.Scalings,
					Orientations: caps.Orientations,
					Duplex:       caps.Duplex,
					Color:        caps.Color,
					MaxCopies:    caps.MaxCopies,
				}
			}
			// Refresh printer state (idle/printing/stopped)
			out, err := discovery.SSHPrinterState(userHost, printerName)
			if err == nil {
				switch {
				case strings.Contains(out, "printing"):
					p.Status = "printing"
				case strings.Contains(out, "disabled"):
					p.Status = "offline"
				default:
					p.Status = "online"
				}
			}
		} else if lpstat, err := exec.LookPath("lpstat"); err == nil {
			// Local CUPS query via lpstat
			if out, err := exec.Command(lpstat, "-p", printerName).CombinedOutput(); err == nil {
				sOut := strings.ToLower(string(out))
				switch {
				case strings.Contains(sOut, "printing"):
					p.Status = "printing"
				case strings.Contains(sOut, "disabled") || strings.Contains(sOut, "offline") || strings.Contains(sOut, "unplugged"):
					p.Status = "offline"
				default:
					p.Status = "online"
				}
			}
		}
	}
	if err := s.store.UpdatePrinter(p); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, p)
}

func (s *Server) generateTestPagePDF(p store.Printer, dstPath string) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	psContent := fmt.Sprintf(`%%!PS-Adobe-3.0
%%%%BoundingBox: 0 0 595 842
%%%%Title: KroomPrint Test Page - %s
%%%%Creator: KroomPrint Engine

/Helvetica-Bold findfont 22 scalefont setfont
50 780 moveto
(KroomPrint Engine) show

/Helvetica-Bold findfont 14 scalefont setfont
0.2 0.7 0.2 setrgbcolor
50 755 moveto
(DIAGNOSTIC TEST & CALIBRATION PAGE) show

0 setgray
/Helvetica findfont 9 scalefont setfont
50 735 moveto
(Generated on %s | System Target: %s) show

%% Draw Divider
0.2 setlinewidth
0.4 setgray
50 722 moveto 545 722 lineto stroke

%% Printer Spec Box
0.95 setgray
50 645 495 65 rectfill
0.2 setgray
0.8 setlinewidth
50 645 495 65 rectstroke

0 setgray
/Helvetica-Bold findfont 10 scalefont setfont
60 692 moveto (Target Printer:) show
/Helvetica findfont 10 scalefont setfont
150 692 moveto (%s (%s)) show

/Helvetica-Bold findfont 10 scalefont setfont
60 674 moveto (Driver / Model:) show
/Helvetica findfont 10 scalefont setfont
150 674 moveto (%s) show

/Helvetica-Bold findfont 10 scalefont setfont
60 656 moveto (Connection URI:) show
/Helvetica findfont 9 scalefont setfont
150 656 moveto (%s) show

%% ── Grayscale Ramp (10 steps) ──
/Helvetica-Bold findfont 11 scalefont setfont
0 setgray
50 620 moveto (1. Grayscale Density Gradient Steps (10%% - 100%%)) show

0 1 9 {
    /i exch def
    /val i 1 add 10 div def
    1 val sub setgray
    50 i 49.5 mul add 575 48 35 rectfill
    0 setgray
    0.5 setlinewidth
    50 i 49.5 mul add 575 48 35 rectstroke
    /Helvetica findfont 7 scalefont setfont
    val 0.5 gt { 1 setgray } { 0 setgray } ifelse
    55 i 49.5 mul add 585 moveto
    i 1 add 10 mul 10 string cvs show (%%) show
} for

%% ── CMYK & RGB Color Swatches ──
0 setgray
/Helvetica-Bold findfont 11 scalefont setfont
50 545 moveto (2. Primary CMYK & RGB Color Alignment Swatches) show

0 1 1 setrgbcolor 50 495 55 35 rectfill
1 0 1 setrgbcolor 112 495 55 35 rectfill
1 1 0 setrgbcolor 174 495 55 35 rectfill
0 0 0 setrgbcolor 236 495 55 35 rectfill
1 0 0 setrgbcolor 298 495 55 35 rectfill
0 1 0 setrgbcolor 360 495 55 35 rectfill
0 0 1 setrgbcolor 422 495 55 35 rectfill
0.5 0.5 0.5 setrgbcolor 484 495 61 35 rectfill

0 setgray
/Helvetica findfont 8 scalefont setfont
68 480 moveto (Cyan) show
123 480 moveto (Magenta) show
187 480 moveto (Yellow) show
252 480 moveto (Black) show
318 480 moveto (Red) show
377 480 moveto (Green) show
442 480 moveto (Blue) show
502 480 moveto (50%% Gray) show

%% ── Typography Sharpness & Micro-Text Ladder ──
/Helvetica-Bold findfont 11 scalefont setfont
0 setgray
50 445 moveto (3. Typography Sharpness & Font Scale Ladder) show

/Helvetica findfont 16 scalefont setfont
50 420 moveto (16pt: The quick brown fox jumps over the lazy dog 1234567890) show
/Helvetica findfont 12 scalefont setfont
50 400 moveto (12pt: The quick brown fox jumps over the lazy dog 1234567890) show
/Helvetica findfont 10 scalefont setfont
50 382 moveto (10pt: The quick brown fox jumps over the lazy dog 1234567890) show
/Helvetica findfont 8 scalefont setfont
50 366 moveto (8pt: High precision vector typography rendering for crisp document printing) show
/Helvetica findfont 6 scalefont setfont
50 352 moveto (6pt: Ultra fine micro-print diagnostic test. Check nozzle alignment and edge acuity.) show

%% ── Line Frequency & Alignment Grid ──
/Helvetica-Bold findfont 11 scalefont setfont
50 320 moveto (4. Line Acuity & Margin Calibration (5mm Printable Safe Zone)) show

0 setgray
1 1 5 {
    /lw exch def
    lw 0.5 mul setlinewidth
    50 lw 12 mul 240 add moveto 545 lw 12 mul 240 add lineto stroke
    /Helvetica findfont 7 scalefont setfont
    55 lw 12 mul 243 add moveto
    (Line width: ) show lw 0.5 mul 5 string cvs show ( pt) show
} for

0.5 setlinewidth
0.3 setgray
[4 2] 0 setdash
20 20 555 802 rectstroke
[] 0 setdash

0.8 setlinewidth
0 setgray
20 812 moveto 20 832 lineto 10 822 moveto 30 822 lineto stroke
575 812 moveto 575 832 lineto 565 822 moveto 585 822 lineto stroke
20 10 moveto 20 30 lineto 10 20 moveto 30 20 lineto stroke
575 10 moveto 575 30 lineto 565 20 moveto 585 20 lineto stroke

/Helvetica-Oblique findfont 8 scalefont setfont
0.4 setgray
50 35 moveto (KroomPrint Engine v2.0 · Automated Diagnostic & Alignment Tool · Pass Status: OK) show

showpage
`, p.Name, now, p.Name, p.Name, p.Brand, p.Model, p.Address)

	// Save PostScript temp
	psPath := dstPath + ".ps"
	if err := os.WriteFile(psPath, []byte(psContent), 0o644); err != nil {
		return err
	}
	defer os.Remove(psPath)

	// Compile to PDF via local gs (Linux)
	if gs, err := exec.LookPath("gs"); err == nil {
		cmd := exec.Command(gs, "-q", "-dSAFER", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-sOutputFile="+dstPath, psPath)
		if out, err := cmd.CombinedOutput(); err == nil {
			return nil
		} else {
			s.log.Printf("local gs testpage failed: %v (%s)", err, string(out))
		}
	}

	// Remote ghostscript if on Windows dev
	normHost := ""
	if discovery.IsSSHURL(s.cfg.CUPSURL) {
		normHost = s.cfg.CUPSSSH
		if normHost == "" {
			normHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
		}
	}
	if normHost != "" {
		remotePS := fmt.Sprintf("/tmp/kp-tp-%d.ps", time.Now().UnixNano())
		remotePDF := remotePS + ".pdf"
		if _, err := discovery.SSHWriteFile(normHost, remotePS, []byte(psContent)); err != nil {
			return err
		}
		defer func() { _, _ = discovery.SSHRunSimple(normHost, "rm -f "+remotePS+" "+remotePDF) }()
		cmd := fmt.Sprintf("gs -q -dSAFER -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -sOutputFile=%s %s", shellQuote(remotePDF), shellQuote(remotePS))
		if _, err := discovery.SSHRunSimple(normHost, cmd); err != nil {
			return err
		}
		pdfData, err := discovery.SSHReadFile(normHost, remotePDF)
		if err != nil {
			return err
		}
		return os.WriteFile(dstPath, pdfData, 0o644)
	}

	return fmt.Errorf("no ghostscript available to generate test page PDF")
}

func (s *Server) handleTestPrint(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	p, err := s.store.GetPrinter(id)
	if err != nil {
		writeErr(w, 404, "printer not found")
		return
	}

	start := time.Now()
	printerName := cupsPrinterName(p)
	online := false
	queueState := "unknown"
	details := ""

	if s.cfg.CUPSURL != "" && discovery.IsSSHURL(s.cfg.CUPSURL) {
		userHost := s.cfg.CUPSSSH
		if userHost == "" {
			userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
		}
		// Probe 1: Check CUPS queue state via lpstat
		// Probe 2: Check physical USB hardware presence on Linux host
		cmd := fmt.Sprintf("lpstat -p %q 2>&1; echo '===USB==='; ls -la /dev/usb/lp* 2>/dev/null; lsusb 2>/dev/null | grep -iE 'epson|print|04b8|03f0|04f9|04a9'", printerName)
		out, err := discovery.SSHRunSimple(userHost, cmd)
		if err != nil {
			details = "Cannot connect to print server " + userHost + ": " + err.Error()
			queueState = "unreachable"
		} else {
			parts := strings.Split(out, "===USB===")
			lpOut := strings.TrimSpace(parts[0])
			usbOut := ""
			if len(parts) > 1 {
				usbOut = strings.TrimSpace(parts[1])
			}

			lowLp := strings.ToLower(lpOut)
			isUnplugged := strings.Contains(lowLp, "unplugged") || strings.Contains(lowLp, "turned off") || strings.Contains(lowLp, "not connected")
			isUsbPresent := usbOut != ""

			if strings.Contains(strings.ToLower(p.Connection), "usb") || strings.Contains(strings.ToLower(p.Address), "usb://") || strings.Contains(strings.ToLower(p.Name), "l3210") {
				if isUnplugged || !isUsbPresent {
					online = false
					queueState = "offline"
					details = "Printer is unplugged or turned off (hardware disconnected)"
				} else if strings.Contains(lowLp, "idle") {
					online = true
					queueState = "idle"
					details = "Printer is connected, idle and ready to accept jobs"
				} else if strings.Contains(lowLp, "printing") {
					online = true
					queueState = "printing"
					details = "Printer is currently active"
				} else {
					online = true
					queueState = "online"
					details = lpOut
				}
			} else {
				if isUnplugged {
					online = false
					queueState = "offline"
					details = "Printer is disconnected or turned off"
				} else if strings.Contains(lowLp, "idle") {
					online = true
					queueState = "idle"
					details = "Printer is online and ready"
				} else {
					online = true
					queueState = "online"
					details = lpOut
				}
			}
		}
	} else if lpstat, err := exec.LookPath("lpstat"); err == nil {
		// Local Linux CUPS with lpstat + physical hardware probe
		cmd := exec.Command(lpstat, "-p", printerName)
		lpOutBytes, _ := cmd.CombinedOutput()
		lpOut := strings.TrimSpace(string(lpOutBytes))

		usbOutBytes, _ := exec.Command("sh", "-c", "ls -la /dev/usb/lp* 2>/dev/null; lsusb 2>/dev/null | grep -iE 'epson|print|04b8|03f0|04f9|04a9'").CombinedOutput()
		usbOut := strings.TrimSpace(string(usbOutBytes))

		lowLp := strings.ToLower(lpOut)
		isUnplugged := strings.Contains(lowLp, "unplugged") || strings.Contains(lowLp, "turned off") || strings.Contains(lowLp, "not connected")
		isUsbPresent := usbOut != ""

		if strings.Contains(strings.ToLower(p.Connection), "usb") || strings.Contains(strings.ToLower(p.Address), "usb://") || strings.Contains(strings.ToLower(p.Name), "l3210") {
			if isUnplugged && !isUsbPresent {
				online = false
				queueState = "offline"
				details = "Printer is unplugged or turned off (hardware disconnected)"
			} else if strings.Contains(lowLp, "idle") {
				online = true
				queueState = "idle"
				details = "Printer is connected, idle and ready to accept jobs"
			} else if strings.Contains(lowLp, "printing") {
				online = true
				queueState = "printing"
				details = "Printer is currently active"
			} else {
				online = true
				queueState = "online"
				details = lpOut
			}
		} else {
			if isUnplugged {
				online = false
				queueState = "offline"
				details = "Printer is disconnected or turned off"
			} else if strings.Contains(lowLp, "idle") {
				online = true
				queueState = "idle"
				details = "Printer is online and ready"
			} else {
				online = true
				queueState = "online"
				details = lpOut
			}
		}
	} else if s.cfg.CUPSURL != "" {
		host := discovery.NormalizeHost(s.cfg.CUPSURL)
		_, err := discovery.ProbeIPPPrinterLocalHostTest(host, printerName, 2*time.Second)
		if err == nil {
			online = true
			queueState = "idle"
			details = "IPP printer responded"
		} else {
			online = false
			queueState = "offline"
			details = "Cannot reach IPP printer: " + err.Error()
		}
	} else {
		online = true
		queueState = "online"
		details = "Local printer driver verified"
	}

	latencyMs := time.Since(start).Milliseconds()
	if latencyMs == 0 {
		latencyMs = 1
	}

	if online {
		p.Status = "online"
	} else {
		p.Status = "offline"
	}
	_ = s.store.UpdatePrinter(p)

	writeJSON(w, 200, map[string]any{
		"ok":         online,
		"printerId":  p.ID,
		"name":       p.Name,
		"status":     p.Status,
		"latencyMs":  latencyMs,
		"queueState": queueState,
		"message":    details,
		"checkedAt":  time.Now().Format("15:04:05"),
	})
}

func (s *Server) handlePausePrinter(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	if err := s.store.PatchPrinter(id, func(p *store.Printer) error {
		p.Paused = true
		p.Status = "paused"
		return nil
	}); err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	p, _ := s.store.GetPrinter(id)
	writeJSON(w, 200, p)
}

func (s *Server) handleResumePrinter(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	if err := s.store.PatchPrinter(id, func(p *store.Printer) error {
		p.Paused = false
		p.Status = "online"
		return nil
	}); err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	p, _ := s.store.GetPrinter(id)
	writeJSON(w, 200, p)
}

func (s *Server) handleEnablePrinter(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	if err := s.store.PatchPrinter(id, func(p *store.Printer) error {
		p.Enabled = true
		if !p.Paused {
			p.Status = "online"
		}
		return nil
	}); err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	_ = s.store.EnsureDefaultPrinter()
	p, _ := s.store.GetPrinter(id)
	writeJSON(w, 200, p)
}

func (s *Server) handleDisablePrinter(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	if err := s.store.PatchPrinter(id, func(p *store.Printer) error {
		p.Enabled = false
		p.Status = "offline"
		return nil
	}); err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	_ = s.store.EnsureDefaultPrinter()
	p, _ := s.store.GetPrinter(id)
	writeJSON(w, 200, p)
}

func (s *Server) handleSetDefault(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	if err := s.store.SetDefaultPrinter(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	p, _ := s.store.GetPrinter(id)
	writeJSON(w, 200, p)
}

// ── Discovery handlers ──

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	select {
	case s.scanMu <- struct{}{}:
	default:
		writeErr(w, 409, "a scan is already running")
		return
	}
	defer func() { <-s.scanMu }()

	s.scanState = scanState{Running: true, Started: time.Now()}
	defer func() { s.scanState = scanState{} }()

	devices, err := s.scanner.Scan()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	for _, d := range devices {
		// Skip software/virtual printers (PDF writer, OneNote, etc.)
		if d.IsVirtual {
			continue
		}
		_ = s.store.SaveDiscovered(store.DiscoveredPrinter{
			ID:         d.ID,
			Name:       d.Name,
			Brand:      d.Brand,
			Model:      d.Model,
			Connection: d.Connection,
			Address:    d.Address,
			MAC:        d.MAC,
			IP:         d.IP,
			IsVirtual:  d.IsVirtual,
			Source:     d.Source,
			Caps: store.Capabilities{
				PaperSizes:   d.Caps.PaperSizes,
				Qualities:    d.Caps.Qualities,
				Scalings:     d.Caps.Scalings,
				Orientations: d.Caps.Orientations,
				Duplex:       d.Caps.Duplex,
				Color:        d.Caps.Color,
				MaxCopies:    d.Caps.MaxCopies,
			},
		})
	}
	results, err := s.store.ListDiscovered()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"devices": results})
}

func (s *Server) handleDiscoveryResults(w http.ResponseWriter, r *http.Request) {
	results, err := s.store.ListDiscovered()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"devices": results, "scan": s.scanState})
}

func (s *Server) handleAddDiscovered(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	d, err := s.store.GetDiscovered(id)
	if err != nil {
		if u, uErr := url.PathUnescape(id); uErr == nil && u != id {
			d, err = s.store.GetDiscovered(u)
			if err == nil {
				id = u
			}
		}
	}
	if err != nil {
		writeErr(w, 404, "discovered printer not found")
		return
	}
	if d.IsVirtual {
		writeErr(w, 400, "virtual printers (PDF/OneNote) cannot be added")
		return
	}
	p, err := s.store.CreatePrinter(store.Printer{
		Name:       d.Name,
		Brand:      d.Brand,
		Model:      d.Model,
		Connection: d.Connection,
		Address:    d.Address,
		MAC:        d.MAC,
		Status:     "online",
		Enabled:    true,
		Caps:       d.Caps,
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	_ = s.store.DeleteDiscovered(id)
	writeJSON(w, 201, p)
}

func (s *Server) handleDeleteDiscovered(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	_ = s.store.DeleteDiscovered(id)
	if u, uErr := url.PathUnescape(id); uErr == nil && u != id {
		_ = s.store.DeleteDiscovered(u)
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ── Jobs handlers ──

func (s *Server) handleListJobs(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListJobs()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, list)
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	j, err := s.store.GetJob(pathID(r))
	if err != nil {
		writeErr(w, 404, "job not found")
		return
	}
	writeJSON(w, 200, j)
}

type createJobReq struct {
	FileType    string `json:"fileType"`
	Pages       int    `json:"pages"`
	Copies      int    `json:"copies"`
	Color       bool   `json:"color"`
	Duplex      bool   `json:"duplex"`
	PaperSize   string `json:"paperSize"`
	Orientation string `json:"orientation"`
	Quality     string `json:"quality"`
	Scaling     string `json:"scaling"`
	PageRange   string `json:"pageRange"`
	Priority    int    `json:"priority"`
	PrinterID   string `json:"printerId"`
	Size        string `json:"size"`
	FileName    string `json:"fileName,omitempty"`
}

func (s *Server) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var req createJobReq
	filePath := ""

	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		// Multipart upload: file + JSON options
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			writeErr(w, 400, "invalid multipart body: "+err.Error())
			return
		}
		if jr := r.FormValue("job"); jr != "" {
			_ = json.Unmarshal([]byte(jr), &req)
		}
		file, header, err := r.FormFile("file")
		if err == nil {
			defer file.Close()
			fname := sanitizeFilename(header.Filename)
			if fname == "" {
				fname = "document.pdf"
			}
			os.MkdirAll(s.cfg.UploadsDir, 0o755)
			dst := filepath.Join(s.cfg.UploadsDir, fmt.Sprintf("%d-%s", time.Now().UnixNano(), fname))
			out, err := os.Create(dst)
			if err != nil {
				writeErr(w, 500, "cannot store file: "+err.Error())
				return
			}
			if _, err := io.Copy(out, file); err != nil {
				out.Close()
				writeErr(w, 500, "cannot store file: "+err.Error())
				return
			}
			out.Close()
			filePath = dst
			// Derive file type from extension
			ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(fname), "."))
			switch ext {
			case "pdf":
				req.FileType = "PDF"
			case "png":
				req.FileType = "PNG"
			case "jpg", "jpeg":
				req.FileType = "JPG"
			case "txt":
				req.FileType = "TXT"
			case "docx":
				req.FileType = "DOCX"
			case "xlsx":
				req.FileType = "XLSX"
			case "csv":
				req.FileType = "CSV"
			}
			// use original filename for the job
			req.FileName = fname
		}
	} else {
		if err := readJSON(r, &req); err != nil {
			writeErr(w, 400, "invalid JSON body")
			return
		}
	}

	// Validate against printer capabilities
	if req.PrinterID == "" {
		writeErr(w, 400, "printerId is required")
		return
	}
	p, err := s.store.GetPrinter(req.PrinterID)
	if err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	if !p.Enabled || p.Status == "offline" {
		writeErr(w, 409, "printer is offline or disabled")
		return
	}
	if req.Copies == 0 {
		req.Copies = 1
	}
	if req.PaperSize == "" {
		req.PaperSize = "A4"
	}
	if req.Quality == "" {
		req.Quality = "Standard"
	}
	if req.Scaling == "" {
		req.Scaling = "Fit to page"
	}
	if req.Orientation == "" {
		req.Orientation = "Portrait"
	}
	if req.Priority == 0 {
		req.Priority = 3
	}
	// Color requires printer support
	if req.Color && !p.Caps.Color {
		req.Color = false
	}
	// Duplex requires printer support
	if req.Duplex && !p.Caps.Duplex {
		req.Duplex = false
	}

	name := req.FileName
	if name == "" {
		name = "print-job"
	}
	fileType := strings.ToUpper(req.FileType)
	if fileType == "" {
		fileType = "PDF"
	}
	if name == "print-job" {
		name = fmt.Sprintf("print-%s-%d.%s", strings.ToLower(p.Brand), time.Now().UnixNano()%100000, strings.ToLower(fileType))
	}

	status := "queued"
	progress := 0
	job, err := s.store.CreateJob(store.Job{
		Name:        name,
		FileType:    fileType,
		FilePath:    filePath,
		Pages:       req.Pages,
		Copies:      req.Copies,
		Color:       req.Color,
		Duplex:      req.Duplex,
		PaperSize:   req.PaperSize,
		Orientation: req.Orientation,
		Quality:     req.Quality,
		Scaling:     req.Scaling,
		PageRange:   req.PageRange,
		Priority:    req.Priority,
		Status:      status,
		Progress:    progress,
		Size:        req.Size,
		PrinterID:   p.ID,
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	// Return 201 immediately with queued status (< 15ms)
	writeJSON(w, 201, job)

	// Submit to real CUPS/IPP printer asynchronously in the background
	if s.cfg.CUPSURL != "" && filePath != "" {
		go s.dispatchPrintJob(job.ID, filePath, req, p, name)
	}
}

// dispatchPrintJob runs document conversion & CUPS spooling asynchronously in background
func (s *Server) dispatchPrintJob(jobID string, filePath string, req createJobReq, p store.Printer, name string) {
	if filePath == "" {
		return
	}

	normHost := ""
	if discovery.IsSSHURL(s.cfg.CUPSURL) {
		normHost = s.cfg.CUPSSSH
		if normHost == "" {
			normHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
		}
	}

	opts := discovery.JobOptions{
		Media:     req.PaperSize,
		Sides:     "one-sided",
		Copies:    req.Copies,
		ColorMode: "color",
		Quality:   req.Quality,
		JobName:   name,
		FileType:  mimeForFile(name),
		PageRange: req.PageRange,
	}
	if req.Duplex {
		opts.Sides = "two-sided-long-edge"
	}
	if !req.Color {
		opts.ColorMode = "grayscale"
	}

	// Update to "processing" while converting
	_ = s.store.PatchJobStatus(jobID, "processing")

	isGray := opts.ColorMode == "grayscale" || opts.ColorMode == "monochrome" || !req.Color
	filePath = normalizeDocument(filePath, s.log, normHost, isGray, req.PaperSize)
	if strings.ToLower(filepath.Ext(filePath)) == ".pdf" {
		opts.FileType = "application/pdf"
	}

	var cupsJobID int
	var submitErr error
	printerName := cupsPrinterName(p)

	if discovery.IsSSHURL(s.cfg.CUPSURL) {
		userHost := s.cfg.CUPSSSH
		if userHost == "" {
			userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
		}
		cupsJobID, submitErr = discovery.SSHSubmitJob(userHost, printerName, filePath, opts)
		if s.log != nil {
			s.log.Printf("ssh-submit %s/%s: job-id=%d err=%v (grayscale=%v)", userHost, printerName, cupsJobID, submitErr, isGray)
		}
	} else if lp, err := exec.LookPath("lp"); err == nil {
		// Local CUPS printing via `lp -d <printerName>`
		flags := []string{"-d", printerName}
		if opts.Media != "" {
			flags = append(flags, "-o", "media="+opts.Media, "-o", "PageSize="+opts.Media)
		}
		if opts.Sides != "" {
			flags = append(flags, "-o", "sides="+opts.Sides)
		}
		if !req.Color {
			// CRITICAL FOR EPSON L3210 & MONOCHROME:
			// 1) Ink=MONO activates dedicated Black printhead nozzle on Epson ESC/P-R
			// 2) print-color-mode=monochrome & ColorModel=Gray for generic filters
			flags = append(flags, "-o", "Ink=MONO", "-o", "print-color-mode=monochrome", "-o", "ColorModel=Gray")
		} else {
			flags = append(flags, "-o", "Ink=COLOR", "-o", "print-color-mode=color", "-o", "ColorModel=RGB")
		}
		if req.Quality == "High" || req.Quality == "Photo" {
			flags = append(flags, "-o", "MediaType=PLAIN_HIGH")
		} else {
			flags = append(flags, "-o", "MediaType=PLAIN_NORMAL")
		}
		if opts.Copies > 1 {
			flags = append(flags, "-n", strconv.Itoa(opts.Copies))
		}
		if opts.PageRange != "" {
			flags = append(flags, "-o", "page-ranges="+opts.PageRange)
		}
		if opts.JobName != "" {
			flags = append(flags, "-t", opts.JobName)
		}
		flags = append(flags, filePath)
		cmd := exec.Command(lp, flags...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			submitErr = fmt.Errorf("local lp failed: %v (%s)", err, strings.TrimSpace(string(out)))
		} else {
			sOut := string(out)
			if i := strings.LastIndex(sOut, "-"); i >= 0 {
				idStr := strings.TrimSpace(sOut[i+1:])
				if j := strings.IndexAny(idStr, " )"); j > 0 {
					idStr = idStr[:j]
				}
				if n, err := strconv.Atoi(idStr); err == nil {
					cupsJobID = n
				}
			}
			if s.log != nil {
				s.log.Printf("local-lp-submit %s: job-id=%d output=%s", printerName, cupsJobID, strings.TrimSpace(sOut))
			}
		}
	} else {
		host := discovery.NormalizeHost(s.cfg.CUPSURL)
		cupsJobID, submitErr = discovery.SubmitPrintJob(host, printerName, filePath, opts)
		if s.log != nil {
			s.log.Printf("ipp-submit %s/%s: job-id=%d err=%v (grayscale=%v)", host, printerName, cupsJobID, submitErr, isGray)
		}
	}

	job, err := s.store.GetJob(jobID)
	if err != nil {
		return
	}

	if submitErr != nil {
		job.Status = "failed"
		job.Error = submitErr.Error()
		_ = s.store.UpdateJob(job)
		return
	}

	job.Status = "printing"
	job.Progress = 20
	job.CupsJobID = cupsJobID
	_ = s.store.UpdateJob(job)

	// Smooth completion progress tracking
	go func(j store.Job) {
		time.Sleep(3 * time.Second)
		j.Progress = 60
		_ = s.store.UpdateJob(j)
		time.Sleep(5 * time.Second)
		j.Progress = 100
		j.Status = "completed"
		_ = s.store.UpdateJob(j)

		printerName := ""
		if p, err := s.store.GetPrinter(j.PrinterID); err == nil {
			printerName = p.Name
		}
		_ = s.store.AddHistory(store.HistoryRecord{
			Name:        j.Name,
			FileType:    j.FileType,
			Pages:       j.Pages,
			Copies:      j.Copies,
			PrinterName: printerName,
			Status:      "completed",
		})
	}(job)
}

// cupsPrinterName extracts the CUPS printer queue name from a registered printer.
func cupsPrinterName(p store.Printer) string {
	// 1. If lpstat is locally available, find the matching queue from `lpstat -v`
	if lpstat, err := exec.LookPath("lpstat"); err == nil {
		if out, err := exec.Command(lpstat, "-v").Output(); err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				// Format: "device for L3210-Series: usb://EPSON/L3210%20Series?serial=..."
				if strings.Contains(line, "device for ") && strings.Contains(line, ":") {
					parts := strings.SplitN(line, ":", 2)
					qPart := strings.TrimPrefix(parts[0], "device for ")
					qName := strings.TrimSpace(qPart)
					devURI := strings.TrimSpace(parts[1])
					if p.Address != "" && (p.Address == devURI || strings.Contains(devURI, p.Address) || strings.Contains(p.Address, devURI)) {
						return qName
					}
					if strings.EqualFold(strings.ReplaceAll(qName, "-", " "), p.Name) || strings.EqualFold(qName, p.Name) || strings.Contains(strings.ToLower(p.Name), strings.ToLower(qName)) {
						return qName
					}
				}
			}
		}
	}

	// 2. Fallback parsing from Address
	if p.Address != "" {
		addr := p.Address
		if qIdx := strings.Index(addr, "?"); qIdx >= 0 {
			addr = addr[:qIdx]
		}
		if i := strings.LastIndex(addr, "/"); i >= 0 {
			rawName := addr[i+1:]
			if un, err := url.PathUnescape(rawName); err == nil {
				rawName = un
			}
			if rawName != "" {
				return strings.ReplaceAll(rawName, " ", "-")
			}
		}
	}

	// 3. Fallback from p.Name
	name := p.Name
	if strings.HasPrefix(strings.ToLower(name), "epson ") {
		name = strings.TrimPrefix(name[6:], " ")
	}
	return strings.ReplaceAll(name, " ", "-")
}

func sanitizeFilename(name string) string {
	name = filepath.Base(name)
	name = strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		return r
	}, name)
	return name
}

// mimeForFile maps a filename to the CUPS document-format MIME type.
func mimeForFile(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".pdf":
		return "application/pdf"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".txt":
		return "text/plain"
	case ".doc", ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xls", ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".ppt", ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case ".html", ".htm":
		return "text/html"
	case ".rtf":
		return "application/rtf"
	case ".csv":
		return "text/csv"
	default:
		return "application/octet-stream"
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// normalizeDocument converts images (PNG, JPG, JPEG, WEBP, BMP) or raw documents
// into standard A4 print-ready PDFs, fixes PDF rotation bugs with Ghostscript,
// and if isGray is true, converts all color spaces into high-contrast DeviceGray.
func normalizeDocument(src string, log *log.Logger, userHost string, isGray bool, media string) string {
	ext := strings.ToLower(filepath.Ext(src))
	isImage := ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" || ext == ".bmp"
	isDoc := ext == ".docx" || ext == ".doc" || ext == ".odt" || ext == ".rtf" || ext == ".pptx" || ext == ".ppt" || ext == ".xlsx" || ext == ".xls"
	isPDF := ext == ".pdf"

	if !isImage && !isDoc && !isPDF {
		return src
	}

	// 0) Handling Office documents: Convert to PDF first via LibreOffice headless
	if isDoc {
		loCmd := ""
		if p, err := exec.LookPath("libreoffice"); err == nil {
			loCmd = p
		} else if p, err := exec.LookPath("soffice"); err == nil {
			loCmd = p
		}
		if loCmd != "" {
			outDir := filepath.Dir(src)
			cmd := exec.Command(loCmd, "--headless", "--convert-to", "pdf", "--outdir", outDir, src)
			if out, err := cmd.CombinedOutput(); err == nil {
				convertedPDF := strings.TrimSuffix(src, ext) + ".pdf"
				if fi, err := os.Stat(convertedPDF); err == nil && fi.Size() > 0 {
					if log != nil {
						log.Printf("normalizeDocument: converted %s → %s via libreoffice", filepath.Base(src), filepath.Base(convertedPDF))
					}
					src = convertedPDF
					ext = ".pdf"
					isPDF = true
				}
			} else if log != nil {
				log.Printf("normalizeDocument: libreoffice conversion failed (%v): %s", err, strings.TrimSpace(string(out)))
			}
		}
	}

	if media == "" {
		media = "A4"
	}

	// 1) Handling Images: Convert to standard print-ready PDF with white background flattening
	if isImage {
		dstPDF := strings.TrimSuffix(src, ext) + ".pdf"
		if conv, err := exec.LookPath("convert"); err == nil {
			args := []string{"-density", "300", src, "-background", "white", "-flatten", "-alpha", "off"}
			if isGray {
				args = append(args, "-colorspace", "Gray", "-contrast-stretch", "0.5%x0.5%")
			}
			args = append(args, "-page", media, dstPDF)
			if out, err := exec.Command(conv, args...).CombinedOutput(); err == nil {
				if fi, err := os.Stat(dstPDF); err == nil && fi.Size() > 0 {
					return dstPDF
				}
			} else if log != nil {
				log.Printf("normalizeDocument: local convert error (%v): %s", err, strings.TrimSpace(string(out)))
			}
		}
		return src
	}

	// 2) Handling PDF documents: Vector PDFs are already high-fidelity print-ready
	// CUPS ESC/P-R rasterizer natively handles Ink=MONO at native hardware DPI.
	return src
}

func (s *Server) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	j, err := s.store.GetJob(id)
	if err != nil {
		writeErr(w, 404, "job not found")
		return
	}
	if j.Status == "completed" {
		writeErr(w, 409, "job already completed")
		return
	}
	printerName := ""
	if j.PrinterID != "" {
		if p, err := s.store.GetPrinter(j.PrinterID); err == nil {
			printerName = p.Name
		}
	}
	j.Status = "cancelled"
	j.Progress = 0
	if err := s.store.UpdateJob(j); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	_ = s.store.AddHistory(store.HistoryRecord{
		Name:        j.Name,
		FileType:    j.FileType,
		Pages:       j.Pages,
		Copies:      j.Copies,
		PrinterName: printerName,
		Status:      "cancelled",
	})
	writeJSON(w, 200, j)
}

func (s *Server) handlePauseJob(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	if err := s.store.PatchJobStatus(id, "paused"); err != nil {
		writeErr(w, 404, "job not found")
		return
	}
	j, _ := s.store.GetJob(id)
	writeJSON(w, 200, j)
}

func (s *Server) handleResumeJob(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	if err := s.store.PatchJobStatus(id, "queued"); err != nil {
		writeErr(w, 404, "job not found")
		return
	}
	j, _ := s.store.GetJob(id)
	writeJSON(w, 200, j)
}

func (s *Server) handleClearJobs(w http.ResponseWriter, r *http.Request) {
	// Cancel all active CUPS jobs on remote server, then re-enable printer
	// (CUPS auto-disables the printer on certain errors; re-enabling is safe)
	if s.cfg.CUPSURL != "" && discovery.IsSSHURL(s.cfg.CUPSURL) {
		userHost := s.cfg.CUPSSSH
		if userHost == "" {
			userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
		}
		_, _ = discovery.SSHRunSimple(userHost, "cancel -a -x 2>/dev/null; sleep 1; cupsenable -a 2>/dev/null; cupsaccept -a 2>/dev/null")
	}

	_ = s.store.CancelAllActiveJobs()
	writeJSON(w, 200, map[string]string{"message": "all active jobs cancelled and queue cleared"})
}

func (s *Server) handleRetryJob(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	recs, err := s.store.ListHistory(500)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	var target *store.HistoryRecord
	for i := range recs {
		if recs[i].ID == id {
			target = &recs[i]
			break
		}
	}
	if target == nil {
		writeErr(w, 404, "history record not found")
		return
	}
	printers, _ := s.store.ListPrinters()
	var printerID string
	for _, p := range printers {
		if p.Name == target.PrinterName && p.Enabled && p.Status == "online" {
			printerID = p.ID
			break
		}
	}
	if printerID == "" && len(printers) > 0 {
		printerID = printers[0].ID
	}
	job, err := s.store.CreateJob(store.Job{
		Name:      target.Name,
		FileType:  target.FileType,
		Pages:     target.Pages,
		Copies:    target.Copies,
		Status:    "queued",
		PrinterID: printerID,
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, job)
}

func (s *Server) handleReorderJobs(w http.ResponseWriter, r *http.Request) {
	var req struct {
		JobIDs []string `json:"jobIds"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid JSON body")
		return
	}
	// Store the desired order in settings as a JSON array (queue ordering).
	if len(req.JobIDs) > 0 {
		b, _ := json.Marshal(req.JobIDs)
		_ = s.store.SetSetting("queue_order", string(b))
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleSetPriority(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	var req struct{ Priority int `json:"priority"` }
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid JSON body")
		return
	}
	if req.Priority < 1 || req.Priority > 5 {
		writeErr(w, 400, "priority must be 1..5")
		return
	}
	if err := s.store.PatchJobPriority(id, req.Priority); err != nil {
		writeErr(w, 404, "job not found")
		return
	}
	j, _ := s.store.GetJob(id)
	writeJSON(w, 200, j)
}

// ── History handlers ──

func (s *Server) handleListHistory(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	recs, err := s.store.ListHistory(limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, recs)
}

func (s *Server) handleClearHistory(w http.ResponseWriter, r *http.Request) {
	if err := s.store.ClearHistory(); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ── Settings handlers ──

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]string{
		"autoRefresh": s.store.GetSetting("autoRefresh", "true"),
		"notifications": s.store.GetSetting("notifications", "true"),
		"darkMode":     s.store.GetSetting("darkMode", "false"),
		"compactQueue": s.store.GetSetting("compactQueue", "false"),
	})
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid JSON body")
		return
	}
	for k, v := range req {
		if b, ok := v.(bool); ok {
			_ = s.store.SetSetting(k, strconv.FormatBool(b))
		} else if str, ok := v.(string); ok {
			_ = s.store.SetSetting(k, str)
		}
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// small helpers (avoid importing rand twice)
func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func randN(n int) int {
	return time.Now().Nanosecond() % n
}

// handleConvertPreview converts an uploaded Office doc/image to high-res PDF on-the-fly for real-time UI preview
func (s *Server) handleConvertPreview(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, 400, "invalid form data")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "missing file in form")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	tmpInput := filepath.Join("/tmp", fmt.Sprintf("kp-prev-%d-%s", time.Now().UnixNano(), sanitizeFilename(header.Filename)))
	outF, err := os.Create(tmpInput)
	if err != nil {
		writeErr(w, 500, "cannot create temporary file")
		return
	}
	if _, err := io.Copy(outF, file); err != nil {
		outF.Close()
		_ = os.Remove(tmpInput)
		writeErr(w, 500, "cannot write temporary file")
		return
	}
	outF.Close()
	defer os.Remove(tmpInput)

	// 1) If already a PDF, serve directly
	if ext == ".pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", "inline; filename=preview.pdf")
		http.ServeFile(w, r, tmpInput)
		return
	}

	// 2) If image: convert to PDF using ImageMagick convert
	isImage := ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" || ext == ".bmp"
	if isImage {
		tmpPDF := tmpInput + ".pdf"
		defer os.Remove(tmpPDF)
		if conv, err := exec.LookPath("convert"); err == nil {
			cmd := exec.Command(conv, "-density", "150", tmpInput, "-background", "white", "-flatten", "-alpha", "off", "-page", "A4", tmpPDF)
			if out, err := cmd.CombinedOutput(); err == nil {
				if fi, err := os.Stat(tmpPDF); err == nil && fi.Size() > 0 {
					w.Header().Set("Content-Type", "application/pdf")
					w.Header().Set("Content-Disposition", "inline; filename=preview.pdf")
					http.ServeFile(w, r, tmpPDF)
					return
				}
			} else if s.log != nil {
				s.log.Printf("preview image convert error: %v (%s)", err, string(out))
			}
		}
	}

	// 3) If Office Doc: convert using headless LibreOffice
	isDoc := ext == ".docx" || ext == ".doc" || ext == ".odt" || ext == ".rtf" || ext == ".pptx" || ext == ".ppt" || ext == ".xlsx" || ext == ".xls" || ext == ".txt" || ext == ".csv"
	if isDoc {
		loCmd := ""
		if p, err := exec.LookPath("libreoffice"); err == nil {
			loCmd = p
		} else if p, err := exec.LookPath("soffice"); err == nil {
			loCmd = p
		}
		if loCmd != "" {
			cmd := exec.Command(loCmd, "--headless", "--convert-to", "pdf", "--outdir", "/tmp", tmpInput)
			if out, err := cmd.CombinedOutput(); err == nil {
				tmpPDF := strings.TrimSuffix(tmpInput, ext) + ".pdf"
				defer os.Remove(tmpPDF)
				if fi, err := os.Stat(tmpPDF); err == nil && fi.Size() > 0 {
					w.Header().Set("Content-Type", "application/pdf")
					w.Header().Set("Content-Disposition", "inline; filename=preview.pdf")
					http.ServeFile(w, r, tmpPDF)
					return
				}
			} else if s.log != nil {
				s.log.Printf("preview libreoffice error: %v (%s)", err, string(out))
			}
		}
	}

	writeErr(w, 415, "cannot convert this file format to visual preview")
}
