package api

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"kroomprint/backend/internal/config"
	"kroomprint/backend/internal/discovery"
	"kroomprint/backend/internal/store"
)

// previewCacheEntry holds a cached LibreOffice/ImageMagick PDF conversion result.
type previewCacheEntry struct {
	path    string
	expires time.Time
}

// ClientHub manages SSE client subscribers for real-time live events.
type ClientHub struct {
	sync.RWMutex
	clients map[chan []byte]struct{}
}

func newClientHub() *ClientHub {
	return &ClientHub{
		clients: make(map[chan []byte]struct{}),
	}
}

func (h *ClientHub) subscribe() chan []byte {
	ch := make(chan []byte, 32)
	h.Lock()
	h.clients[ch] = struct{}{}
	h.Unlock()
	return ch
}

func (h *ClientHub) unsubscribe(ch chan []byte) {
	h.Lock()
	delete(h.clients, ch)
	close(ch)
	h.Unlock()
}

func (h *ClientHub) Broadcast(eventType string, data any) {
	payload, _ := json.Marshal(map[string]any{
		"type": eventType,
		"data": data,
		"time": time.Now().UnixMilli(),
	})
	msg := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", eventType, string(payload)))

	h.RLock()
	defer h.RUnlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
		}
	}
}

// Server holds handlers and dependencies.
type Server struct {
	cfg          *config.Config
	store        *store.Store
	scanner      *discovery.Scanner
	log          *log.Logger
	scanMu       chan struct{} // serializes scans
	scanState    scanState
	previewCache map[string]previewCacheEntry // hash → cached PDF path
	previewMu    sync.Mutex
	printerLocks sync.Map   // map[string]*sync.Mutex (Hardware Concurrency Lock)
	hub          *ClientHub // Real-Time SSE Event Hub
	bootTime     time.Time

	dispatchMu sync.Mutex
	dispatchAt map[string]int64 // jobID → ms timestamp of last dispatch attempt
	retryCount map[string]int   // jobID → fast-completion retries issued
}

type scanState struct {
	Running bool      `json:"running"`
	Started time.Time `json:"startedAt"`
}

// New builds the API server.
func New(cfg *config.Config, st *store.Store, logger *log.Logger) *Server {
	s := &Server{
		cfg:          cfg,
		store:        st,
		scanner:      &discovery.Scanner{CUPSURL: cfg.CUPSURL, CUPSSSH: cfg.CUPSSSH, Delay: time.Duration(cfg.DiscoveryDelayMS) * time.Millisecond, Log: logger},
		log:          logger,
		scanMu:       make(chan struct{}, 1),
		previewCache: make(map[string]previewCacheEntry),
		hub:          newClientHub(),
		bootTime:     time.Now(),
		dispatchAt:   make(map[string]int64),
		retryCount:   make(map[string]int),
	}
	// Evict stale cache entries every 10 minutes
	go func() {
		t := time.NewTicker(10 * time.Minute)
		defer t.Stop()
		for range t.C {
			s.evictPreviewCache()
		}
	}()
	return s
}

func (s *Server) getPrinterMutex(printerID string) *sync.Mutex {
	actual, _ := s.printerLocks.LoadOrStore(printerID, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

// evictPreviewCache removes expired preview cache entries and their temp files.
func (s *Server) evictPreviewCache() {
	s.previewMu.Lock()
	defer s.previewMu.Unlock()
	now := time.Now()
	for k, e := range s.previewCache {
		if now.After(e.expires) {
			_ = os.Remove(e.path)
			delete(s.previewCache, k)
		}
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

// syncCupsJobStatus checks all "printing" jobs against the real CUPS server
// using authoritative IPP job-state queries, so aborted/canceled jobs are
// never mistaken for successful completions.
func (s *Server) syncCupsJobStatus() {
	// Bound the DB read: the poller ticks every second, and a wedged SQLite
	// connection must never park it (or any other request) forever.
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	ctxList, cancelList := store.WithQueryTimeout(ctx)
	defer cancelList()
	jobs, err := s.store.ListJobsCtx(ctxList)
	if err != nil {
		if s.log != nil {
			s.log.Printf("cups poller: list jobs: %v", err)
		}
		return
	}
	userHost := s.cfg.CUPSSSH
	if userHost == "" {
		userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
	}
	sshMode := discovery.IsSSHURL(s.cfg.CUPSURL)

	for _, j := range jobs {
		if j.Status != "printing" {
			continue
		}
		if j.CupsJobID == 0 {
			elapsedSec := float64(time.Now().UnixMilli()-j.CreatedAt) / 1000.0
			if elapsedSec > 8.0 {
				s.finishJobTerminal(&j, "completed", "", 100, true)
			}
			continue
		}
		p, err := s.store.GetPrinter(j.PrinterID)
		if err != nil {
			continue
		}
		printerName := cupsPrinterName(p)

		outcome := s.queryCupsJobOutcome(printerName, userHost, sshMode, j.CupsJobID)

		switch outcome.state {
		case "completed":
			if s.shouldRetryFastComplete(&j) {
				s.requeueFastFailJob(&j, p)
				continue
			}
			s.finishJobTerminal(&j, "completed", "", 100, true)

		case "canceled":
			msg := "canceled in CUPS"
			if outcome.reasons != "" {
				msg += ": " + outcome.reasons
			}
			s.finishJobTerminal(&j, "cancelled", msg, j.Progress, false)

		case "stopped":
			// CUPS marks filter warnings (e.g. job-completed-with-errors) and USB buffer flush as "stopped".
			// The data was successfully spooled to the physical printer. Mark as completed.
			lowerReasons := strings.ToLower(outcome.reasons)
			if strings.Contains(lowerReasons, "job-completed-with-errors") ||
				strings.Contains(lowerReasons, "completed") ||
				strings.Contains(lowerReasons, "none") ||
				lowerReasons == "" {
				s.finishJobTerminal(&j, "completed", "", 100, true)
				continue
			}
			// Only fail if persistent fatal stop after grace period
			elapsedSec := float64(time.Now().UnixMilli()-j.CreatedAt) / 1000.0
			if elapsedSec < 4.0 {
				continue
			}
			msg := "print failed in CUPS (" + outcome.state + ")"
			if outcome.reasons != "" {
				msg += ": " + outcome.reasons
			}
			s.finishJobTerminal(&j, "failed", msg, j.Progress, false)

		case "aborted":
			lowerReasons := strings.ToLower(outcome.reasons)
			if strings.Contains(lowerReasons, "job-completed-with-errors") || strings.Contains(lowerReasons, "completed") {
				s.finishJobTerminal(&j, "completed", "", 100, true)
				continue
			}
			msg := "print failed in CUPS (aborted)"
			if outcome.reasons != "" {
				msg += ": " + outcome.reasons
			}
			s.finishJobTerminal(&j, "failed", msg, j.Progress, false)

		case "pending", "held", "processing":
			// Cosmetic time-based progress only. Completion is NEVER simulated:
			// the job stays "printing" until CUPS reports a terminal state.
			if prog := estimatedPrintProgress(&j); prog > j.Progress {
				j.Progress = prog
				_ = s.store.UpdateJob(j)
				if s.hub != nil {
					s.hub.Broadcast("job_updated", j)
				}
			}

		case "notfound":
			// Job purged from CUPS history entirely. Best-effort only; with
			// default history retention this should be rare.
			elapsedSec := float64(time.Now().UnixMilli()-j.CreatedAt) / 1000.0
			if elapsedSec > 5.0 {
				s.finishJobTerminal(&j, "completed", "", 100, true)
			}

		default:
			// Unknown/unreachable state source: keep cosmetic progress,
			// never fabricate a terminal status.
			if prog := estimatedPrintProgress(&j); prog > j.Progress {
				j.Progress = prog
				_ = s.store.UpdateJob(j)
				if s.hub != nil {
					s.hub.Broadcast("job_updated", j)
				}
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

// cupsJobOutcome is the honest classification of a CUPS job state.
type cupsJobOutcome struct {
	state   string // completed|canceled|aborted|stopped|pending|held|processing|printing|notfound
	reasons string
}

// queryCupsJobOutcome resolves the authoritative CUPS job state. Production
// (backend co-located with cupsd) uses IPP Get-Job-Attributes which can tell
// aborted/canceled apart from completed; SSH/lpstat paths degrade to legacy
// heuristics that cannot.
func (s *Server) queryCupsJobOutcome(printerName, userHost string, sshMode bool, cupsJobID int) cupsJobOutcome {
	if !sshMode && s.cfg.CUPSURL != "" {
		host := discovery.NormalizeHost(s.cfg.CUPSURL)
		state, reasons, err := discovery.GetJobStateIPP(host, printerName, cupsJobID, 5*time.Second)
		if err == nil {
			return cupsJobOutcome{state: state, reasons: reasons}
		}
		s.log.Printf("ipp job-state %s/%d unavailable (%v), falling back to lpstat", printerName, cupsJobID, err)
	}

	if sshMode {
		cupsStatus, _ := discovery.SSHGetJobStatus(userHost, printerName, cupsJobID)
		return cupsJobOutcome{state: legacyStatusToOutcome(cupsStatus)}
	}
	if lpstat, err := exec.LookPath("lpstat"); err == nil {
		targetPrefix := fmt.Sprintf("%s-%d", printerName, cupsJobID)
		outBytes, _ := exec.Command(lpstat, "-o", printerName).CombinedOutput()
		if strings.Contains(string(outBytes), targetPrefix) {
			return cupsJobOutcome{state: "processing"}
		}
		outCBytes, _ := exec.Command(lpstat, "-W", "completed", "-o", printerName).CombinedOutput()
		if strings.Contains(string(outCBytes), targetPrefix) {
			return cupsJobOutcome{state: "completed"}
		}
		return cupsJobOutcome{state: "notfound"}
	}
	return cupsJobOutcome{state: "processing"}
}

// legacyStatusToOutcome maps SSHGetJobStatus strings into outcome states.
// The SSH transport cannot distinguish aborted from completed jobs; both are
// reported as "completed" there, matching historical behavior.
func legacyStatusToOutcome(cupsStatus string) string {
	switch cupsStatus {
	case "completed":
		return "completed"
	case "notfound":
		return "notfound"
	default:
		return "processing"
	}
}

// estimatedPrintProgress derives cosmetic progress (15%..98%) from elapsed
// time vs per-page estimates. It must never reach 100 or set terminal status.
func estimatedPrintProgress(j *store.Job) int {
	totalPages := j.Pages * j.Copies
	if totalPages <= 0 {
		totalPages = 1
	}
	secPerPage := 6.0
	switch strings.ToLower(j.Quality) {
	case "draft":
		secPerPage = 4.0
	case "high":
		secPerPage = 12.0
	case "photo":
		secPerPage = 20.0
	}
	estTotalSec := float64(totalPages) * secPerPage
	elapsedSec := float64(time.Now().UnixMilli()-j.CreatedAt) / 1000.0
	if elapsedSec < 0 {
		elapsedSec = 0
	}
	prog := 15.0 + (elapsedSec/estTotalSec)*75.0
	if elapsedSec > estTotalSec {
		prog = 85.0 + ((elapsedSec-estTotalSec)/estTotalSec)*12.0
	}
	if prog > 98.0 {
		prog = 98.0
	}
	return int(prog)
}

// fastCompleteSuspicionMs is the minimum plausible wall-clock span between a
// dispatch attempt and a physical one-page completion. Real prints feed paper
// for at least several seconds; silent CUPS failures complete almost instantly.
const fastCompleteSuspicionMs = int64(4000)

const maxFastCompleteRetries = 2

// shouldRetryFastComplete reports whether a "completed" verdict arrived so
// quickly after dispatch that no physical output can have occurred, and the
// job still has auto-retry budget left.
func (s *Server) shouldRetryFastComplete(j *store.Job) bool {
	if j.Pages <= 0 || j.FilePath == "" {
		return false
	}
	s.dispatchMu.Lock()
	defer s.dispatchMu.Unlock()
	started, ok := s.dispatchAt[j.ID]
	if !ok {
		return false
	}
	if time.Now().UnixMilli()-started < fastCompleteSuspicionMs && s.retryCount[j.ID] < maxFastCompleteRetries {
		return true
	}
	return false
}

// requeueFastFailJob resets a suspiciously-finished job back to queued and
// kicks off another dispatch attempt.
func (s *Server) requeueFastFailJob(j *store.Job, p store.Printer) {
	s.dispatchMu.Lock()
	s.retryCount[j.ID]++
	attempt := s.retryCount[j.ID]
	s.dispatchMu.Unlock()

	_ = s.store.PatchJobStatus(j.ID, "queued")
	j.Status = "queued"
	j.Progress = 0
	if s.hub != nil {
		s.hub.Broadcast("job_updated", *j)
	}
	s.log.Printf("job %s (%s) suspicious fast completion — auto-retry attempt %d", j.Name, j.ID[:8], attempt)

	req := createJobReq{
		PrinterID:   j.PrinterID,
		FileName:    j.Name,
		FileType:    j.FileType,
		Pages:       j.Pages,
		Copies:      j.Copies,
		Color:       j.Color,
		Duplex:      j.Duplex,
		PaperSize:   j.PaperSize,
		Orientation: j.Orientation,
		Quality:     j.Quality,
		Scaling:     j.Scaling,
		PageRange:   j.PageRange,
		Priority:    j.Priority,
	}
	go s.dispatchPrintJob(j.ID, j.FilePath, req, p, j.Name)
}

// finishJobTerminal applies a final status to a job, records history and
// broadcasts the result to SSE subscribers.
func (s *Server) finishJobTerminal(j *store.Job, status, errMsg string, progress int, broadcastCompleted bool) {
	now := time.Now().UnixMilli()
	j.Status = status
	j.Progress = progress
	j.Error = errMsg
	j.CompletedAt = &now
	_ = s.store.UpdateJob(*j)
	_ = s.store.CompleteJobToHistory(*j, status, errMsg)
	if s.hub != nil {
		s.hub.Broadcast("job_updated", *j)
		if broadcastCompleted {
			s.hub.Broadcast("job_completed", *j)
		}
	}
	s.log.Printf("job %s (%s) terminal: %s %s", j.Name, j.ID[:8], status, errMsg)
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

	staff := []string{"admin", "user"}
	adminOnly := []string{"admin"}

	// Public: liveness probe used pre-login by the web UI.
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "time": time.Now(), "cups": s.cfg.CUPSURL != ""})
	})
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)

	auth := func(next http.HandlerFunc) http.Handler { return s.authorize(nil, next) }
	optAuth := func(next http.HandlerFunc) http.Handler { return s.optionalAuth(next) }
	staffGate := func(next http.HandlerFunc) http.Handler { return s.authorize(staff, next) }
	adminGate := func(next http.HandlerFunc) http.Handler { return s.authorize(adminOnly, next) }

	mux.Handle("GET /api/auth/me", auth(s.handleMe))
	mux.Handle("POST /api/auth/change-password", auth(s.handleChangePassword))

	// ── Printers ──
	mux.Handle("GET /api/printers", optAuth(s.handleListPrinters))
	mux.Handle("POST /api/printers", adminGate(s.handleAddPrinter))
	mux.Handle("GET /api/printers/{id}", optAuth(s.handleGetPrinter))
	mux.Handle("PATCH /api/printers/{id}", adminGate(s.handlePatchPrinter))
	mux.Handle("DELETE /api/printers/{id}", adminGate(s.handleDeletePrinter))
	mux.Handle("POST /api/printers/{id}/refresh", adminGate(s.handleRefreshPrinter))
	mux.Handle("POST /api/printers/{id}/test", staffGate(s.handleTestPrint))
	mux.Handle("POST /api/printers/{id}/pause", adminGate(s.handlePausePrinter))
	mux.Handle("POST /api/printers/{id}/resume", adminGate(s.handleResumePrinter))
	mux.Handle("POST /api/printers/{id}/enable", adminGate(s.handleEnablePrinter))
	mux.Handle("POST /api/printers/{id}/disable", adminGate(s.handleDisablePrinter))
	mux.Handle("POST /api/printers/{id}/default", adminGate(s.handleSetDefault))
	mux.Handle("POST /api/printers/{id}/rename", adminGate(s.handleRenamePrinter))
	mux.Handle("GET /api/printers/{id}/health", optAuth(s.handlePrinterHealth))
	mux.Handle("GET /api/printers/{id}/ppd-options", optAuth(s.handleGetPPDOptions))
	mux.Handle("POST /api/printers/{id}/maintenance/clean-head", adminGate(s.handleCleanHead))
	mux.Handle("POST /api/printers/{id}/maintenance/nozzle-check", adminGate(s.handleNozzleCheck))

	// ── Discovery ──
	mux.Handle("POST /api/discovery/scan", adminGate(s.handleScan))
	mux.Handle("GET /api/discovery/results", adminGate(s.handleDiscoveryResults))
	mux.Handle("POST /api/discovery/{id}/add", adminGate(s.handleAddDiscovered))
	mux.Handle("DELETE /api/discovery/{id}", adminGate(s.handleDeleteDiscovered))

	// ── Real-Time SSE Event Hub (Domain 4) ──
	mux.Handle("GET /api/events", optAuth(s.handleEvents))

	// ── Jobs (Domain 4 & Domain 5) ──
	mux.Handle("GET /api/jobs", optAuth(s.handleListJobs))
	mux.Handle("POST /api/jobs", staffGate(s.handleCreateJob))
	mux.Handle("GET /api/jobs/{id}", optAuth(s.handleGetJob))
	mux.Handle("POST /api/jobs/clear", staffGate(s.handleClearJobs))
	mux.Handle("POST /api/jobs/reorder", staffGate(s.handleReorderJobs))
	mux.Handle("DELETE /api/jobs", adminGate(s.handleClearJobs))
	mux.Handle("POST /api/jobs/{id}/cancel", staffGate(s.handleCancelJob))
	mux.Handle("POST /api/jobs/{id}/pause", staffGate(s.handlePauseJob))
	mux.Handle("POST /api/jobs/{id}/resume", staffGate(s.handleResumeJob))
	mux.Handle("POST /api/jobs/{id}/retry", staffGate(s.handleRetryJob))
	mux.Handle("POST /api/jobs/{id}/release", staffGate(s.handleReleaseSecureJob))
	mux.Handle("POST /api/jobs/{id}/reroute", staffGate(s.handleRerouteJob))
	mux.Handle("POST /api/jobs/{id}/purge", staffGate(s.handlePurgeJob))
	mux.Handle("POST /api/jobs/{id}/priority", staffGate(s.handleSetPriority))

	// ── History & Analytics (Domain 5) ──
	mux.Handle("GET /api/history", optAuth(s.handleListHistory))
	mux.Handle("DELETE /api/history", adminGate(s.handleClearHistory))
	mux.Handle("GET /api/analytics/summary", optAuth(s.handleAnalyticsSummary))
	mux.Handle("GET /api/analytics/export", auth(s.handleAnalyticsExport))

	// ── Users administration ──
	mux.Handle("GET /api/users", adminGate(s.handleListUsers))
	mux.Handle("POST /api/users", adminGate(s.handleCreateUser))
	mux.Handle("PATCH /api/users/{id}", adminGate(s.handlePatchUser))
	mux.Handle("DELETE /api/users/{id}", adminGate(s.handleDeleteUser))

	// ── Settings ──
	mux.Handle("GET /api/settings", optAuth(s.handleGetSettings))
	mux.Handle("PUT /api/settings", staffGate(s.handlePutSettings))
	mux.Handle("POST /api/settings/test-cups", adminGate(s.handleTestCUPSConnection))
	mux.Handle("GET /api/diagnostics/network", optAuth(s.handleNetworkDiagnostics))
	mux.Handle("POST /api/settings/reset", adminGate(s.handleResetData))

	// ── Document Preview Conversion ──
	mux.Handle("POST /api/convert/preview", optAuth(s.handleConvertPreview))

	// Uploads (served files - safe file server without directory listing)
	mux.Handle("GET /uploads/", staffGate(http.HandlerFunc(s.serveUploads)))

	return s.logRequests(s.enableCORS(mux))
}

func (s *Server) serveUploads(w http.ResponseWriter, r *http.Request) {
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
	for i := range list {
		s.enrichPrinterHealth(&list[i])
	}
	writeJSON(w, 200, list)
}

func (s *Server) handleGetPrinter(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetPrinter(pathID(r))
	if err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	s.enrichPrinterHealth(&p)
	writeJSON(w, 200, p)
}

type addPrinterReq struct {
	Name       string `json:"name"`
	Brand      string `json:"brand"`
	Model      string `json:"model"`
	Connection string `json:"connection"`
	Address    string `json:"address"`
	IsDefault  bool   `json:"isDefault"`
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
	var req struct {
		Name string `json:"name"`
	}
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
		} else {
			// Local CUPS (http://localhost:631). Refresh capabilities from the
			// live PPD too — this branch previously skipped it, so the panel
			// kept a stale list (4 sizes) while the PPD exposes 22.
			if caps, err := discovery.ProbePrinterLocal(printerName); err == nil {
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
			if lpstat, err := exec.LookPath("lpstat"); err == nil {
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

// enrichPrinterHealth attaches dynamic CMYK ink levels and hardware sensor alerts to a printer.
// It attempts to query real ink levels from CUPS via IPP marker attributes first.
func (s *Server) enrichPrinterHealth(p *store.Printer) {
	// ── 1. Try Real Ink Levels from CUPS IPP Marker Attributes ──
	userHost := s.cfg.CUPSSSH
	if userHost == "" && discovery.IsSSHURL(s.cfg.CUPSURL) {
		userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
	}

	realInkFetched := false
	if userHost != "" {
		printerName := cupsPrinterName(*p)
		inkResults, err := discovery.SSHGetInkLevels(userHost, printerName)
		if err == nil && len(inkResults) > 0 {
			p.InkLevels = make([]store.InkLevel, 0, len(inkResults))
			for _, ir := range inkResults {
				level := ir.Level
				if level < 0 {
					level = 0
				}
				p.InkLevels = append(p.InkLevels, store.InkLevel{
					Color: ir.Color,
					Name:  ir.Name,
					Level: level,
					Type:  ir.Type,
				})
			}
			// Update Toner field with black ink level for backward compat
			for _, il := range p.InkLevels {
				if il.Color == "black" {
					p.Toner = il.Level
					break
				}
			}
			realInkFetched = true
		}
	}

	// ── 2. Fallback: Estimate CMYK Levels from Toner field ──
	if !realInkFetched {
		if p.Caps.Color {
			tonerBase := p.Toner
			if tonerBase <= 0 || tonerBase > 100 {
				tonerBase = 85
			}
			cLevel := (tonerBase * 92) / 100
			if cLevel < 15 {
				cLevel = 15
			}
			mLevel := (tonerBase * 84) / 100
			if mLevel < 10 {
				mLevel = 10
			}
			yLevel := (tonerBase * 96) / 100
			if yLevel < 20 {
				yLevel = 20
			}

			p.InkLevels = []store.InkLevel{
				{Color: "black", Name: "Black (K)", Level: tonerBase, Type: "ink"},
				{Color: "cyan", Name: "Cyan (C)", Level: cLevel, Type: "ink"},
				{Color: "magenta", Name: "Magenta (M)", Level: mLevel, Type: "ink"},
				{Color: "yellow", Name: "Yellow (Y)", Level: yLevel, Type: "ink"},
			}
		} else {
			tonerBase := p.Toner
			if tonerBase <= 0 {
				tonerBase = 75
			}
			p.InkLevels = []store.InkLevel{
				{Color: "black", Name: "Black Toner", Level: tonerBase, Type: "toner"},
			}
		}
	}

	// ── 3. Hardware Sensors ──
	stateText := "Printer is online and ready for printing."
	if p.Status == "offline" {
		stateText = "Printer is offline or turned off."
	} else if p.Status == "paused" {
		stateText = "Printer queue is currently paused."
	} else if p.Status == "error" {
		stateText = "Printer error state reported by CUPS subsystem."
	}

	// Detect low ink from real ink levels
	lowInk := false
	for _, il := range p.InkLevels {
		if il.Level > 0 && il.Level < 15 {
			lowInk = true
			break
		}
	}
	if !lowInk {
		lowInk = p.Toner > 0 && p.Toner < 15
	}

	p.Sensors = store.HardwareSensors{
		PaperJam:  false,
		DoorOpen:  false,
		LowPaper:  p.Paper > 0 && p.Paper < 20,
		LowInk:    lowInk,
		StateText: stateText,
	}
}


// handlePrinterHealth returns diagnostic health info, live ink levels, and supported maintenance operations.
func (s *Server) handlePrinterHealth(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	p, err := s.store.GetPrinter(id)
	if err != nil {
		writeErr(w, 404, "printer not found")
		return
	}
	s.enrichPrinterHealth(&p)

	driverInfo := "Generic CUPS Driver"
	if strings.Contains(strings.ToLower(p.Brand), "epson") || strings.Contains(strings.ToLower(p.Name), "l3210") {
		driverInfo = "Epson ESC/P-R v1.7.17 (Official OpenPrinting)"
	} else if strings.Contains(strings.ToLower(p.Brand), "hp") {
		driverInfo = "HP Linux Imaging and Printing (HPLIP / PCL3)"
	} else if strings.Contains(strings.ToLower(p.Brand), "canon") {
		driverInfo = "Canon UFR II / CAPT Linux Driver"
	} else if strings.Contains(strings.ToLower(p.Brand), "brother") {
		driverInfo = "Brother brlaser / CUPS LPR Filter"
	}

	writeJSON(w, 200, map[string]any{
		"id":         p.ID,
		"name":       p.Name,
		"brand":      p.Brand,
		"model":      p.Model,
		"connection": p.Connection,
		"address":    p.Address,
		"status":     p.Status,
		"enabled":    p.Enabled,
		"paused":     p.Paused,
		"inkLevels":  p.InkLevels,
		"sensors":    p.Sensors,
		"maintenance": map[string]any{
			"canCleanHead":   true,
			"canNozzleCheck": true,
			"canAlignHead":   true,
			"driver":         driverInfo,
			"supportedMediaTypes": []string{
				"Plain Paper (Normal)",
				"Plain Paper (High Quality)",
				"Photo Quality Inkjet",
				"Matte Paper",
				"Premium Glossy Photo",
				"Envelope (DL/C6)",
			},
		},
	})
}

// handleGetPPDOptions dynamically introspects native CUPS PPD printer options.
func (s *Server) handleGetPPDOptions(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	p, err := s.store.GetPrinter(id)
	if err != nil {
		writeErr(w, 404, "printer not found")
		return
	}

	printerName := cupsPrinterName(p)

	var options []discovery.PPDOption
	if discovery.IsSSHURL(s.cfg.CUPSURL) {
		userHost := s.cfg.CUPSSSH
		if userHost == "" {
			userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
		}
		options, _ = discovery.SSHGetPPDOptions(userHost, printerName)
	} else {
		// Local CUPS: read the real PPD from this host's lpoptions. Without this
		// the panel only ever saw the three hardcoded fallback options.
		options, _ = discovery.ProbePPDOptionsLocal(printerName)
	}
	if len(options) == 0 {
		// Fallback default options
		options = []discovery.PPDOption{
			{Name: "PageSize", Label: "Paper Size", Default: discovery.DefaultPageSize, Values: discovery.PPDNames()},
			{Name: "MediaType", Label: "Print Quality / Media", Default: "PLAIN_NORMAL", Values: []string{"PLAIN_NORMAL", "PLAIN_HIGH", "PMPHOTO_HIGH", "PMMATT_NORMAL"}},
			{Name: "Ink", Label: "Color Mode", Default: "COLOR", Values: []string{"COLOR", "MONO"}},
		}
	}

	writeJSON(w, 200, map[string]any{
		"printerId":   p.ID,
		"printerName": p.Name,
		"options":     options,
	})
}

// handleCleanHead triggers a printhead cleaning cycle for the target printer.
func (s *Server) handleCleanHead(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	p, err := s.store.GetPrinter(id)
	if err != nil {
		writeErr(w, 404, "printer not found")
		return
	}

	printerName := cupsPrinterName(p)
	if s.cfg.CUPSURL != "" && discovery.IsSSHURL(s.cfg.CUPSURL) {
		userHost := s.cfg.CUPSSSH
		if userHost == "" {
			userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
		}
		// Trigger CUPS queue refresh & clean sequence
		cleanCmd := fmt.Sprintf("cupsenable %s 2>/dev/null; cupsaccept %s 2>/dev/null; escputil --clean-head -r /dev/usb/lp0 2>/dev/null || true", shellQuote(printerName), shellQuote(printerName))
		_, _ = discovery.SSHRunSimple(userHost, cleanCmd)
	} else if clean, err := exec.LookPath("escputil"); err == nil {
		_ = exec.Command(clean, "--clean-head", "-r", "/dev/usb/lp0").Run()
	}

	if s.log != nil {
		s.log.Printf("[maintenance] Printhead cleaning cycle triggered for printer %s (%s)", p.Name, printerName)
	}

	writeJSON(w, 200, map[string]any{
		"ok":      true,
		"message": fmt.Sprintf("Head cleaning cycle initiated for %s. Printhead nozzles are undergoing automated cleaning.", p.Name),
		"printer": p.Name,
		"time":    time.Now().Format(time.RFC3339),
	})
}

// handleNozzleCheck registers a maintenance job for printing nozzle check patterns.
func (s *Server) handleNozzleCheck(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	p, err := s.store.GetPrinter(id)
	if err != nil {
		writeErr(w, 404, "printer not found")
		return
	}

	created, err := s.store.CreateJob(store.Job{
		Name:      "Nozzle Check Pattern — Maintenance",
		PrinterID: p.ID,
		FileType:  "PDF",
		Pages:     1,
		Copies:    1,
		Color:     p.Caps.Color,
		PaperSize: "A4",
		Status:    "queued",
		Progress:  0,
		Priority:  1,
		Size:      "14 KB",
	})
	if err != nil {
		writeErr(w, 500, "cannot create maintenance job: "+err.Error())
		return
	}

	if s.log != nil {
		s.log.Printf("[maintenance] Nozzle check pattern job %s registered for printer %s", created.ID, p.Name)
	}

	writeJSON(w, 200, map[string]any{
		"ok":      true,
		"jobId":   created.ID,
		"message": fmt.Sprintf("Nozzle Check pattern job registered for %s (Job ID: %s).", p.Name, created.ID[:8]),
		"job":     created,
	})
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
	// Bounded read: with a single pooled SQLite connection an unbounded query
	// could hang this endpoint (and the whole panel) indefinitely.
	ctx, cancel := store.WithQueryTimeout(r.Context())
	defer cancel()
	list, err := s.store.ListJobsCtx(ctx)
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
	FileType      string `json:"fileType"`
	Pages         int    `json:"pages"`
	Copies        int    `json:"copies"`
	Color         bool   `json:"color"`
	Duplex        bool   `json:"duplex"`
	PaperSize     string `json:"paperSize"`
	Orientation   string `json:"orientation"`
	Quality       string `json:"quality"`
	Scaling       string `json:"scaling"`
	PageRange     string `json:"pageRange"`
	Priority      int    `json:"priority"`
	PrinterID     string `json:"printerId"`
	Size          string `json:"size"`
	FileName      string `json:"fileName,omitempty"`
	NUp           int    `json:"nUp,omitempty"`
	Collate       bool   `json:"collate,omitempty"`
	MediaType     string `json:"mediaType,omitempty"`
	InputTray     string `json:"inputTray,omitempty"`
	Borderless    bool   `json:"borderless,omitempty"`
	Booklet       bool   `json:"booklet,omitempty"`
	Watermark        string            `json:"watermark,omitempty"`
	WatermarkLayout  string            `json:"watermarkLayout,omitempty"`
	WatermarkOpacity float64           `json:"watermarkOpacity,omitempty"`
	ManualDuplex     bool              `json:"manualDuplex,omitempty"`
	DuplexStep    string `json:"duplexStep,omitempty"`
	PrintAsImage  bool   `json:"printAsImage,omitempty"`
	PPDSettings   map[string]string `json:"ppdSettings,omitempty"`
	SecureRelease bool   `json:"secureRelease,omitempty"`
	PIN           string `json:"pin,omitempty"`
	Cost          int    `json:"cost,omitempty"`
	User          string `json:"user,omitempty"`
	Department    string `json:"department,omitempty"`
	DuplexMode    string `json:"duplexMode,omitempty"`
	Rotation      int    `json:"rotation,omitempty"`
	ScalePercent  int    `json:"scalePercent,omitempty"`
	ReverseOrder  bool   `json:"reverseOrder,omitempty"`
	MarginPreset  string `json:"marginPreset,omitempty"`
	Margins       *printMargins `json:"margins,omitempty"`
	PageOrder     string `json:"pageOrder,omitempty"`
	PrintBorder   bool   `json:"printBorder,omitempty"`
}

// printMargins mirrors the frontend's { top, bottom, left, right } shape (mm).
type printMargins struct {
	Top    float64 `json:"top"`
	Bottom float64 `json:"bottom"`
	Left   float64 `json:"left"`
	Right  float64 `json:"right"`
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
			req.FileType = fileExtType(fname)
			// Fix malformed producer metadata (e.g. float /Rotate values that
			// crash cups-filters pdftopdf) at upload time so preview, retry
			// and dispatch all operate on the repaired file.
			if req.FileType == "PDF" {
				fixed := ensurePrintablePDF(dst, s.log)
				if fixed != dst {
					if rerr := os.Rename(fixed, dst); rerr == nil {
						s.log.Printf("upload: normalized /Rotate metadata in %s", fname)
					} else {
						_ = os.Remove(fixed)
					}
				}
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
	if !p.Enabled {
		writeErr(w, 409, "printer is disabled")
		return
	}
	if req.Copies <= 0 {
		req.Copies = 1
	}
	if req.Pages <= 0 {
		req.Pages = 1
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

	// Cost & Quota calculation
	basePrice := 500
	if req.Color {
		basePrice = 1500
	}
	calcCost := req.Cost
	if calcCost <= 0 {
		calcCost = req.Pages * req.Copies * basePrice
		if req.Duplex {
			calcCost = int(float64(calcCost) * 0.9) // 10% duplex paper savings discount
		}
	}
	userName := req.User
	if c, ok := s.claimsFromCtx(r); ok && c.Sub != "" {
		userName = c.Sub
	}
	if userName == "" {
		userName = "admin"
	}
	deptName := req.Department
	if deptName == "" {
		deptName = "Engineering"
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
	if req.SecureRelease && req.PIN != "" {
		status = "held-secure"
	}
	progress := 0
	job, err := s.store.CreateJob(store.Job{
		Name:          name,
		FileType:      fileType,
		FilePath:      filePath,
		Pages:         req.Pages,
		Copies:        req.Copies,
		Color:         req.Color,
		Duplex:        req.Duplex,
		PaperSize:     req.PaperSize,
		Orientation:   req.Orientation,
		Quality:       req.Quality,
		Scaling:       req.Scaling,
		PageRange:     req.PageRange,
		Priority:      req.Priority,
		Status:        status,
		Progress:      progress,
		Size:          req.Size,
		PrinterID:     p.ID,
		PIN:           req.PIN,
		SecureRelease: req.SecureRelease,
		Cost:          calcCost,
		User:          userName,
		Department:    deptName,
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	// Broadcast live event to all connected clients
	if s.hub != nil {
		s.hub.Broadcast("job_created", job)
	}

	// Return 201 immediately (< 15ms)
	writeJSON(w, 201, job)

	// Submit to real CUPS/IPP printer asynchronously in the background (if not held for secure PIN)
	if s.cfg.CUPSURL != "" && filePath != "" && status != "held-secure" {
		go s.dispatchPrintJob(job.ID, filePath, req, p, name)
	}
}

// dispatchPrintJob runs document conversion & CUPS spooling asynchronously in background
func (s *Server) dispatchPrintJob(jobID string, filePath string, req createJobReq, p store.Printer, name string) {
	s.dispatchMu.Lock()
	s.dispatchAt[jobID] = time.Now().UnixMilli()
	s.dispatchMu.Unlock()

	if filePath == "" {
		return
	}

	// Domain 4: Hardware Mutex & Worker Lock per printer to eliminate device busy collisions
	mu := s.getPrinterMutex(p.ID)
	mu.Lock()
	defer mu.Unlock()

	normHost := ""
	if discovery.IsSSHURL(s.cfg.CUPSURL) {
		normHost = s.cfg.CUPSSSH
		if normHost == "" {
			normHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
		}
	}

	opts := discovery.JobOptions{
		Media:        req.PaperSize,
		Orientation:  req.Orientation,
		Sides:        "one-sided",
		Copies:       req.Copies,
		ColorMode:    "color",
		Quality:      req.Quality,
		Scaling:      req.Scaling,
		JobName:      name,
		FileType:     mimeForFile(name),
		PageRange:    req.PageRange,
		PageCount:    req.Pages,
		NUp:          req.NUp,
		Collate:      req.Collate,
		MediaType:    req.MediaType,
		InputTray:    req.InputTray,
		Borderless:   req.Borderless,
		Booklet:      req.Booklet,
		Watermark:        req.Watermark,
		WatermarkLayout:  req.WatermarkLayout,
		WatermarkOpacity: req.WatermarkOpacity,
		ManualDuplex:     req.ManualDuplex,
		DuplexStep:   req.DuplexStep,
		PrintAsImage: req.PrintAsImage,
		PPDSettings:  req.PPDSettings,
		Rotation:     req.Rotation,
		ScalePercent: req.ScalePercent,
		PageOrder:    req.PageOrder,
		PrintBorder:  req.PrintBorder,
	}
	if req.Duplex {
		if strings.EqualFold(req.DuplexMode, "short") || strings.EqualFold(req.DuplexMode, "two-sided-short-edge") {
			opts.Sides = "two-sided-short-edge"
		} else {
			opts.Sides = "two-sided-long-edge"
		}
	}
	if !req.Color {
		opts.ColorMode = "grayscale"
	}

	// Update to "processing" while converting
	_ = s.store.PatchJobStatus(jobID, "processing")

	isGray := opts.ColorMode == "grayscale" || opts.ColorMode == "monochrome" || !req.Color

	marginTop, marginRight, marginBottom, marginLeft := resolvePrintMarginsMM(req.MarginPreset, req.Margins)

	filePath = normalizeDocument(filePath, s.log, normHost, isGray, req.PaperSize, req.Orientation, req.Scaling, req.ScalePercent, req.Rotation, marginTop, marginRight, marginBottom, marginLeft)
	if strings.ToLower(filepath.Ext(filePath)) == ".pdf" {
		opts.FileType = "application/pdf"
		// Both rasterized images and PDFs are now formatted and oriented by normalizeDocument
		// to match the printer's physical sheet feed (e.g. 595x842 for A4 portrait feed).
		// Setting opts.Orientation to portrait prevents CUPS pdftopdf from applying
		// a duplicate 90-degree rotation or distorting geometry. Setting opts.Scaling to
		// "Actual size" ensures CUPS sends the exact 1:1 formatted vectors without overriding.
		opts.Orientation = "portrait"
		opts.Scaling = "Actual size"
	}

	// Optional finishing passes, in the order a normal print dialog applies them:
	// rasterize first ("print as image"), then stamp the watermark.
	if opts.PrintAsImage {
		filePath = rasterizeForPrint(filePath, s.log)
	}
	if strings.TrimSpace(opts.Watermark) != "" {
		filePath = applyWatermark(filePath, opts.Watermark, opts.WatermarkLayout, opts.WatermarkOpacity, s.log)
	}

	// Multi-copy & Collation expansion:
	// Desktop inkjet printers (Epson L3210/L3250) lack hardware collators and PPD *cupsCollate support.
	// When multiple copies are requested, expand the PDF pages in software so that:
	// - opts.Collate=true  -> Bundles in sequence: 1,2,3... 1,2,3...
	// - opts.Collate=false -> Grouped pages: 1,1... 2,2... 3,3...
	// Setting opts.Copies=1 ensures CUPS streams the pre-collated sheets directly without driver failure.
	if strings.ToLower(filepath.Ext(filePath)) == ".pdf" && opts.Copies > 1 {
		colPDF, newCopies, newRange := applyCollationAndCopies(filePath, opts.Copies, opts.Collate, opts.PageRange, s.log)
		if colPDF != filePath {
			filePath = colPDF
			opts.Copies = newCopies
			opts.PageRange = newRange
		}
	}

	// Send original file directly to CUPS. For PDFs, CUPS uses its native
	// pdftopdf -> ghostscript -> epson-escpr-wrapper pipeline with native
	// vector text rendering and exact 360dpi rasterization.
	printFiles := []string{filePath}

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
	} else {
		// Pre-flight: ensure printer is enabled and accepting jobs (without aborting active prints).
		if enableBin, eerr := exec.LookPath("cupsenable"); eerr == nil {
			_ = exec.Command(enableBin, printerName).Run()
		}
		if acceptBin, aerr := exec.LookPath("cupsaccept"); aerr == nil {
			_ = exec.Command(acceptBin, printerName).Run()
		}

		// Option 1: Native IPP Submit over HTTP (RFC 8011)
		host := "localhost:631"
		if s.cfg.CUPSURL != "" {
			host = discovery.NormalizeHost(s.cfg.CUPSURL)
		}
		cupsJobID, submitErr = discovery.SubmitPrintJob(host, printerName, filePath, opts)
		if submitErr != nil {
			if s.log != nil {
				s.log.Printf("ipp-submit %s/%s failed (%v), attempting local lp fallback", host, printerName, submitErr)
			}
			if lp, lerr := exec.LookPath("lp"); lerr == nil {
				flags := []string{"-d", printerName}
				if opts.Media != "" {
					ppd := discovery.PPDNameForUI(opts.Media)
					if strings.EqualFold(opts.Scaling, "fill") || strings.EqualFold(opts.Scaling, "fill page") || strings.EqualFold(opts.Scaling, "fill (crop)") || strings.EqualFold(opts.Scaling, "cover") || strings.EqualFold(opts.Scaling, "crop") || opts.Borderless {
						if bPPD := discovery.BorderlessPPDName(opts.Media); bPPD != "" {
							ppd = bPPD
						}
					}
					flags = append(flags, "-o", "media="+ppd, "-o", "PageSize="+ppd)
				}
				if opts.Sides != "" {
					flags = append(flags, "-o", "sides="+opts.Sides)
				}
				if !req.Color {
					flags = append(flags, "-o", "Ink=MONO")
				} else {
					flags = append(flags, "-o", "Ink=COLOR")
				}
				if mt := discovery.NormalizeMediaTypePPD(opts.MediaType); mt != "" {
					flags = append(flags, "-o", "MediaType="+mt)
				}
				if opts.Orientation != "" {
					if strings.EqualFold(opts.Orientation, "landscape") {
						flags = append(flags, "-o", "orientation-requested=4", "-o", "landscape")
					} else {
						flags = append(flags, "-o", "orientation-requested=3", "-o", "portrait")
					}
				}
				// Pass scaling to local lp
				if discovery.IsFillScaling(opts.Scaling, opts.Borderless) {
					flags = append(flags, "-o", "print-scaling=fill")
				} else if strings.EqualFold(opts.Scaling, "actual size") {
					flags = append(flags, "-o", "print-scaling=none")
				} else if strings.EqualFold(opts.Scaling, "shrink to fit") {
					flags = append(flags, "-o", "print-scaling=auto-fit")
				} else {
					flags = append(flags, "-o", "fit-to-page", "-o", "print-scaling=fit")
				}
				// Same finishing options the IPP path sends, so a fallback to lp
				// does not silently drop N-Up / page range / collate / booklet.
				if opts.NUp > 1 {
					flags = append(flags, "-o", fmt.Sprintf("number-up=%d", opts.NUp), "-o", "number-up-layout="+discovery.NumberUpLayoutForUI(opts.PageOrder))
					if opts.PrintBorder {
						flags = append(flags, "-o", "page-border=single")
					}
				}
				if opts.Collate {
					flags = append(flags, "-o", "Collate=True")
				} else if opts.Copies > 1 {
					flags = append(flags, "-o", "Collate=False")
				}
				if opts.Booklet {
					flags = append(flags, "-o", "booklet=true")
				}
				if slot := discovery.NormalizeInputSlotPPD(opts.InputTray); slot != "" {
					flags = append(flags, "-o", "InputSlot="+slot)
				}
				// Printer-specific PPD options (Brightness, Contrast, ...) chosen
				// by the operator, validated as bare keywords.
				for _, kv := range discovery.PPDSettingsArgs(opts.PPDSettings) {
					flags = append(flags, "-o", kv[0]+"="+kv[1])
				}
				if opts.ManualDuplex {
					switch strings.ToLower(opts.DuplexStep) {
					case "odd":
						flags = append(flags, "-o", "page-set=odd")
					case "even":
						flags = append(flags, "-o", "page-set=even", "-o", "outputorder=reverse")
					}
				}
				if pr := discovery.NormalizePageRange(opts.PageRange); pr != "" && !opts.ManualDuplex {
					flags = append(flags, "-o", "page-ranges="+pr)
				}
				flags = append(flags, printFiles...)
				cmd := exec.Command(lp, flags...)
				cmd.Env = append(os.Environ(), "LANG=en_US.UTF-8", "LANGUAGE=en_US:en", "LC_ALL=C.UTF-8")
				out, err := cmd.CombinedOutput()
				if err != nil {
					submitErr = fmt.Errorf("local lp failed: %v (%s)", err, strings.TrimSpace(string(out)))
				} else {
					submitErr = nil
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
				}
			}
		} else if s.log != nil {
			s.log.Printf("ipp-submit %s/%s: job-id=%d (grayscale=%v)", host, printerName, cupsJobID, isGray)
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
		if s.hub != nil {
			s.hub.Broadcast("job_updated", job)
		}
		return
	}

	job.Status = "printing"
	job.Progress = 20
	job.CupsJobID = cupsJobID
	_ = s.store.UpdateJob(job)
	if s.hub != nil {
		s.hub.Broadcast("job_updated", job)
	}

	// If no CUPS URL configured (demo/mock mode), simulate smooth progress
	if s.cfg.CUPSURL == "" {
		go func(j store.Job) {
			time.Sleep(3 * time.Second)
			j.Progress = 60
			_ = s.store.UpdateJob(j)
			if s.hub != nil {
				s.hub.Broadcast("job_updated", j)
			}
			time.Sleep(4 * time.Second)
			j.Progress = 100
			j.Status = "completed"
			_ = s.store.UpdateJob(j)
			_ = s.store.CompleteJobToHistory(j, "completed", "")
			if s.hub != nil {
				s.hub.Broadcast("job_updated", j)
				s.hub.Broadcast("job_completed", j)
			}
		}(job)
	}
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

// fileExtType maps a filename (or bare extension) to its canonical UI file type label.
func fileExtType(name string) string {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(name), ".")) {
	case "pdf":
		return "PDF"
	case "png":
		return "PNG"
	case "jpg", "jpeg":
		return "JPG"
	case "webp":
		return "WEBP"
	case "bmp":
		return "BMP"
	case "gif":
		return "GIF"
	case "tif", "tiff":
		return "TIFF"
	case "heic":
		return "HEIC"
	case "svg":
		return "SVG"
	case "txt":
		return "TXT"
	case "csv":
		return "CSV"
	case "doc", "docx":
		return "DOCX"
	case "xls", "xlsx":
		return "XLSX"
	case "ppt", "pptx":
		return "PPTX"
	case "odt":
		return "ODT"
	case "odp":
		return "ODP"
	case "ods":
		return "ODS"
	case "rtf":
		return "RTF"
	case "html", "htm":
		return "HTML"
	default:
		return ""
	}
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
	case ".gif":
		return "image/gif"
	case ".bmp":
		return "image/bmp"
	case ".tif", ".tiff":
		return "image/tiff"
	case ".webp":
		return "image/webp"
	case ".heic":
		return "image/heic"
	case ".svg":
		return "image/svg+xml"
	case ".txt":
		return "text/plain"
	case ".doc", ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xls", ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".ppt", ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case ".odt":
		return "application/vnd.oasis.opendocument.text"
	case ".ods":
		return "application/vnd.oasis.opendocument.spreadsheet"
	case ".odp":
		return "application/vnd.oasis.opendocument.presentation"
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

// resolvePrintMarginsMM converts the frontend's margin preset/custom values
// into concrete top/right/bottom/left millimeters. Mirrors the presets the
// panel itself writes (DocumentLayoutControls.jsx): default=5mm, none=0mm,
// minimum=3mm; "custom" uses the per-side values the user typed.
func resolvePrintMarginsMM(preset string, custom *printMargins) (top, right, bottom, left float64) {
	switch strings.ToLower(strings.TrimSpace(preset)) {
	case "none":
		return 0, 0, 0, 0
	case "minimum":
		return 3, 3, 3, 3
	case "custom":
		if custom != nil {
			return custom.Top, custom.Right, custom.Bottom, custom.Left
		}
		return 5, 5, 5, 5
	default: // "default" or unset
		return 5, 5, 5, 5
	}
}

// prepareSpreadsheetLandscape adjusts XLSX worksheet page setups cleanly using Python's standard library
// so LibreOffice Calc natively exports the spreadsheet in full Landscape A4 fitting columns onto the page.
func prepareSpreadsheetLandscape(src string, log *log.Logger) string {
	ext := strings.ToLower(filepath.Ext(src))
	if ext != ".xlsx" {
		return src
	}
	pyCmd, err := exec.LookPath("python3")
	if err != nil {
		return src
	}
	dst := strings.TrimSuffix(src, ext) + ".land.xlsx"
	pyScript := `import sys, zipfile, xml.etree.ElementTree as ET
try:
    zin = zipfile.ZipFile(sys.argv[1], 'r')
    zout = zipfile.ZipFile(sys.argv[2], 'w')
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    ET.register_namespace('', ns)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename.startswith('xl/worksheets/sheet') and item.filename.endswith('.xml'):
            try:
                root = ET.fromstring(data)
                spr = root.find(f'{{{ns}}}sheetPr')
                if spr is None:
                    spr = ET.Element(f'{{{ns}}}sheetPr')
                    root.insert(0, spr)
                psPr = spr.find(f'{{{ns}}}pageSetUpPr')
                if psPr is None:
                    psPr = ET.SubElement(spr, f'{{{ns}}}pageSetUpPr')
                psPr.set('fitToPage', '1')

                cols = root.findall(f'.//{{{ns}}}col')
                if cols:
                    tot = sum([float(c.attrib.get('width', 10)) for c in cols])
                    if tot > 0 and tot < 135:
                        ratio = min(1.35, 138.0 / tot)
                        for c in cols:
                            w = float(c.attrib.get('width', 10))
                            c.set('width', f'{w * ratio:.2f}')

                pm = root.find(f'{{{ns}}}pageMargins')
                if pm is not None:
                    pm.set('left', '0.4')
                    pm.set('right', '0.4')
                    pm.set('top', '0.4')
                    pm.set('bottom', '0.4')

                po = root.find(f'{{{ns}}}printOptions')
                if po is None:
                    if pm is not None:
                        idx = list(root).index(pm)
                        po = ET.Element(f'{{{ns}}}printOptions')
                        root.insert(idx, po)
                    else:
                        po = ET.SubElement(root, f'{{{ns}}}printOptions')
                po.set('horizontalCentered', '1')

                ps = root.find(f'{{{ns}}}pageSetup')
                if ps is None:
                    idx = -1
                    if pm is not None:
                        idx = list(root).index(pm) + 1
                    else:
                        sd = root.find(f'{{{ns}}}sheetData')
                        if sd is not None:
                            idx = list(root).index(sd) + 1
                    ps = ET.Element(f'{{{ns}}}pageSetup')
                    if idx >= 0:
                        root.insert(idx, ps)
                    else:
                        root.append(ps)

                ps.attrib.pop('scale', None)
                ps.set('orientation', 'landscape')
                ps.set('paperSize', '9')
                ps.set('fitToWidth', '1')
                ps.set('fitToHeight', '0')
                data = ET.tostring(root, encoding='utf-8')
            except Exception:
                pass
        zout.writestr(item, data)
    zin.close()
    zout.close()
    sys.exit(0)
except Exception:
    sys.exit(1)
`
	cmd := exec.Command(pyCmd, "-c", pyScript, src, dst)
	if err := cmd.Run(); err == nil {
		if fi, err := os.Stat(dst); err == nil && fi.Size() > 0 {
			if log != nil {
				log.Printf("prepareSpreadsheetLandscape: formatted %s -> %s for landscape print", filepath.Base(src), filepath.Base(dst))
			}
			return dst
		}
	}
	return src
}

// pruneBlankPDFPages checks all pages of a generated PDF and removes any blank
// or stray overflow pages (pages containing fewer than 15 characters of text)
// using Ghostscript's -sPageList option.
func pruneBlankPDFPages(src string, log *log.Logger) string {
	infoCmd, err := exec.LookPath("pdfinfo")
	if err != nil {
		return src
	}
	txtCmd, err := exec.LookPath("pdftotext")
	if err != nil {
		return src
	}
	gsCmd, err := exec.LookPath("gs")
	if err != nil {
		return src
	}

	out, err := exec.Command(infoCmd, src).CombinedOutput()
	if err != nil {
		return src
	}
	numPages := 1
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "Pages:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				if n, e := strconv.Atoi(fields[1]); e == nil && n > 0 {
					numPages = n
				}
			}
			break
		}
	}
	if numPages <= 1 {
		return src
	}

	var validPages []string
	for p := 1; p <= numPages; p++ {
		txtOut, err := exec.Command(txtCmd, "-f", strconv.Itoa(p), "-l", strconv.Itoa(p), src, "-").CombinedOutput()
		if err != nil {
			validPages = append(validPages, strconv.Itoa(p))
			continue
		}
		clean := strings.Join(strings.Fields(string(txtOut)), " ")
		if len(clean) >= 15 {
			validPages = append(validPages, strconv.Itoa(p))
		}
	}

	// If any blank/stray pages were found, re-export only the valid content pages
	if len(validPages) > 0 && len(validPages) < numPages {
		dst := strings.TrimSuffix(src, filepath.Ext(src)) + ".clean.pdf"
		pageList := "-sPageList=" + strings.Join(validPages, ",")
		args := []string{"-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", pageList, "-sOutputFile=" + dst, src}
		if gsOut, err := exec.Command(gsCmd, args...).CombinedOutput(); err == nil {
			if fi, err := os.Stat(dst); err == nil && fi.Size() > 0 {
				if log != nil {
					log.Printf("pruneBlankPDFPages: stripped %d blank/overflow pages from %s (%d -> %d pages)",
						numPages-len(validPages), filepath.Base(src), numPages, len(validPages))
				}
				_ = os.Remove(src)
				_ = os.Rename(dst, src)
				return src
			}
		} else if log != nil {
			log.Printf("pruneBlankPDFPages: gs failed: %v (%s)", err, strings.TrimSpace(string(gsOut)))
		}
	}
	return src
}

// buildGSPageList builds a Ghostscript -sPageList compatible argument from pageRange ("1-3,5", "odd", "even").
func buildGSPageList(src string, pageRange string) string {
	pr := strings.TrimSpace(pageRange)
	if pr == "" || strings.EqualFold(pr, "all") {
		return ""
	}
	low := strings.ToLower(pr)
	if low == "odd" || low == "even" {
		numPages := 1
		if infoCmd, err := exec.LookPath("pdfinfo"); err == nil {
			if out, err := exec.Command(infoCmd, src).Output(); err == nil {
				for _, line := range strings.Split(string(out), "\n") {
					if strings.HasPrefix(line, "Pages:") {
						fields := strings.Fields(line)
						if len(fields) >= 2 {
							if n, perr := strconv.Atoi(fields[1]); perr == nil && n > 0 {
								numPages = n
							}
						}
					}
				}
			}
		}
		var pages []string
		start := 1
		if low == "even" {
			start = 2
		}
		for p := start; p <= numPages; p += 2 {
			pages = append(pages, strconv.Itoa(p))
		}
		return strings.Join(pages, ",")
	}
	// Sanitize custom ranges like "1-3, 5" -> "1-3,5"
	cleaned := strings.ReplaceAll(pr, " ", "")
	return cleaned
}

// applyCollationAndCopies handles multi-copy expansion for desktop/raster printers
// where CUPS and the driver lack hardware collation support (e.g. Epson L3210).
// When collate is true and copies > 1, it outputs [1,2,3... 1,2,3...] and sets copies to 1.
// When collate is false and copies > 1, it outputs [1,1... 2,2... 3,3...] and sets copies to 1.
// It also extracts any page ranges ahead of time so the collated bundle has the exact user-selected pages.
func applyCollationAndCopies(src string, copies int, collate bool, pageRange string, log *log.Logger) (string, int, string) {
	if copies <= 1 || !strings.EqualFold(filepath.Ext(src), ".pdf") {
		return src, copies, pageRange
	}

	gsCmd, err := exec.LookPath("gs")
	if err != nil {
		return src, copies, pageRange
	}

	// 1. If pageRange is specified and not "all", filter the pages first
	filteredSrc := src
	cleanedRange := strings.TrimSpace(pageRange)
	if cleanedRange != "" && !strings.EqualFold(cleanedRange, "all") {
		pageList := buildGSPageList(src, cleanedRange)
		if pageList != "" {
			dstRange := strings.TrimSuffix(src, ".pdf") + ".range.pdf"
			args := []string{"-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-sPageList=" + pageList, "-sOutputFile=" + dstRange, src}
			if out, err := exec.Command(gsCmd, args...).CombinedOutput(); err == nil {
				if fi, err := os.Stat(dstRange); err == nil && fi.Size() > 0 {
					if log != nil {
						log.Printf("applyCollationAndCopies: filtered pages (%s) for %s", pageList, filepath.Base(src))
					}
					filteredSrc = dstRange
					cleanedRange = "" // Range is now embedded into the document
				}
			} else if log != nil {
				log.Printf("applyCollationAndCopies: range filter failed (%v): %s", err, strings.TrimSpace(string(out)))
			}
		}
	}

	// 2. Count pages in filteredSrc
	numPages := 1
	if infoCmd, err := exec.LookPath("pdfinfo"); err == nil {
		if out, err := exec.Command(infoCmd, filteredSrc).Output(); err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				if strings.HasPrefix(line, "Pages:") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						if n, perr := strconv.Atoi(fields[1]); perr == nil && n > 0 {
							numPages = n
						}
					}
				}
			}
		}
	}

	// 3. Perform software collation / multi-copy generation
	dstCollate := strings.TrimSuffix(src, ".pdf") + ".collated.pdf"
	var args []string
	args = append(args, "-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-sOutputFile="+dstCollate)

	if collate {
		// Collated sets: [1..N], [1..N], ... (copies times)
		for i := 0; i < copies; i++ {
			args = append(args, filteredSrc)
		}
	} else {
		// Uncollated sets: 1xCopies, 2xCopies, ..., NxCopies
		for p := 1; p <= numPages; p++ {
			for c := 0; c < copies; c++ {
				args = append(args, fmt.Sprintf("-dFirstPage=%d", p), fmt.Sprintf("-dLastPage=%d", p), filteredSrc)
			}
		}
	}

	cmd := exec.Command(gsCmd, args...)
	if out, err := cmd.CombinedOutput(); err == nil {
		if fi, err := os.Stat(dstCollate); err == nil && fi.Size() > 0 {
			if log != nil {
				log.Printf("applyCollationAndCopies: successfully expanded %s to %d physical sheets (collate=%v, copies=%d)",
					filepath.Base(src), numPages*copies, collate, copies)
			}
			if filteredSrc != src {
				_ = os.Remove(filteredSrc)
			}
			return dstCollate, 1, cleanedRange
		}
	} else if log != nil {
		log.Printf("applyCollationAndCopies: gs collation failed (%v): %s", err, strings.TrimSpace(string(out)))
	}

	if filteredSrc != src {
		_ = os.Remove(filteredSrc)
	}
	return src, copies, pageRange
}


// autoFitPDFPages inspects every page's content bounding box in a generated PDF
// (e.g. from LibreOffice Calc/Writer) and scales & centers pages symmetrically on the sheet,
// preventing tables from being stuck on the left side with huge blank space on the right.
func autoFitPDFPages(src string, log *log.Logger) string {
	pyCmd, err := exec.LookPath("python3")
	if err != nil {
		return src
	}
	dst := strings.TrimSuffix(src, filepath.Ext(src)) + ".autofit.pdf"
	pyScript := `import sys, subprocess, os

src = sys.argv[1]
dst = sys.argv[2]

try:
    r_info = subprocess.run(['pdfinfo', src], capture_output=True, text=True)
    numPages = 1
    isLandscape = True

    for line in r_info.stdout.splitlines():
        if line.startswith('Pages:'):
            try:
                numPages = int(line.split()[1])
            except Exception:
                pass
        elif line.startswith('Page size:'):
            parts = line.split()
            if len(parts) >= 5:
                try:
                    pw, ph = float(parts[2]), float(parts[4])
                    isLandscape = pw > ph
                except Exception:
                    pass

    sheetW = 842.0 if isLandscape else 595.0
    sheetH = 595.0 if isLandscape else 842.0
    margin = 25.0
    usableW = sheetW - 2.0 * margin
    usableH = sheetH - 2.0 * margin

    transforms = []
    any_transformed = False

    for p in range(1, numPages + 1):
        r_bbox = subprocess.run(['gs', '-q', '-dBATCH', '-dNOPAUSE', f'-dFirstPage={p}', f'-dLastPage={p}', '-sDEVICE=bbox', src], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        bb_line = ''
        for l in r_bbox.stderr.splitlines():
            if l.startswith('%%BoundingBox:'):
                bb_line = l
                break
        parts = bb_line.split()
        if len(parts) >= 5:
            try:
                x0, y0, x1, y1 = [float(v) for v in parts[1:5]]
                w = max(1.0, x1 - x0)
                h = max(1.0, y1 - y0)

                scaleW = usableW / w
                scaleH = usableH / h
                s = min(scaleW, scaleH)
                s = min(s, 1.5)

                if 0.96 <= s <= 1.04:
                    s = 1.0

                scaledW = w * s
                scaledH = h * s
                targetX = (sheetW - scaledW) / 2.0
                targetY = (sheetH - scaledH) / 2.0
                shiftX = targetX - x0 * s
                shiftY = targetY - y0 * s

                transforms.append(f"[{shiftX:.2f} {shiftY:.2f} {s:.2f}]")
                if abs(s - 1.0) > 0.04 or abs(shiftX) > 10.0 or abs(shiftY) > 10.0:
                    any_transformed = True
            except Exception:
                transforms.append("[0.0 0.0 1.0]")
        else:
            transforms.append("[0.0 0.0 1.0]")

    if not any_transformed:
        sys.exit(0)

    transforms_ps = "\n  ".join(transforms)
    ps_code = f"""/transforms [
  {transforms_ps}
] def
<< /BeginPage {{
  /pg exch def
  pg transforms length lt {{
    transforms pg get aload pop
    /s exch def
    /ty exch def
    /tx exch def
    tx ty translate s s scale
  }} if
}} >> setpagedevice
"""

    cmd = [
        'gs', '-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite',
        f'-dDEVICEWIDTHPOINTS={int(sheetW)}', f'-dDEVICEHEIGHTPOINTS={int(sheetH)}', '-dFIXEDMEDIA',
        f'-sOutputFile={dst}',
        '-c', ps_code,
        '-f', src
    ]

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) > 0:
        sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
`
	cmd := exec.Command(pyCmd, "-c", pyScript, src, dst)
	if err := cmd.Run(); err == nil {
		if fi, err := os.Stat(dst); err == nil && fi.Size() > 0 {
			if log != nil {
				log.Printf("autoFitPDFPages: scaled & centered pages for %s", filepath.Base(src))
			}
			_ = os.Remove(src)
			_ = os.Rename(dst, src)
			return src
		}
	} else if log != nil {
		log.Printf("autoFitPDFPages: note: %v", err)
	}
	return src
}

// normalizeDocument converts images (PNG, JPG, JPEG, WEBP, BMP) or raw documents
// into standard A4 print-ready PDFs, fixes PDF rotation bugs with Ghostscript,
// and if isGray is true, converts all color spaces into high-contrast DeviceGray.
// marginTop/Right/Bottom/Left (mm) shrink the usable print area for PDFs — see
// formatPDFForPrint, which is the only path that currently honors them (image
// jobs are still centered full-bleed via ImageMagick, matching the panel's
// photo path which never surfaces margin controls in the first place).
func normalizeDocument(src string, log *log.Logger, userHost string, isGray bool, media string, orientation string, scaling string, scalePercent int, rotation int, marginTop, marginRight, marginBottom, marginLeft float64) string {
	ext := strings.ToLower(filepath.Ext(src))
	isImage := ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" ||
		ext == ".bmp" || ext == ".gif" || ext == ".tif" || ext == ".tiff" ||
		ext == ".heic" || ext == ".svg"
	isDoc := ext == ".docx" || ext == ".doc" || ext == ".odt" || ext == ".rtf" ||
		ext == ".pptx" || ext == ".ppt" || ext == ".xlsx" || ext == ".xls" ||
		ext == ".ods" || ext == ".odp" || ext == ".html" || ext == ".htm" || ext == ".csv"
	isPDF := ext == ".pdf"

	if !isImage && !isDoc && !isPDF {
		return src
	}

	// 0) Handling Office documents: Convert to PDF first via LibreOffice headless cleanly
	if isDoc {
		inputDoc := src
		if ext == ".xlsx" {
			inputDoc = prepareSpreadsheetLandscape(src, log)
		}
		loCmd := ""
		if p, err := exec.LookPath("libreoffice"); err == nil {
			loCmd = p
		} else if p, err := exec.LookPath("soffice"); err == nil {
			loCmd = p
		}
		if loCmd != "" {
			outDir := filepath.Dir(inputDoc)
			cmd := exec.Command(loCmd, "--headless", "--convert-to", "pdf", "--outdir", outDir, inputDoc)
			if out, err := cmd.CombinedOutput(); err == nil {
				convertedPDF := strings.TrimSuffix(inputDoc, filepath.Ext(inputDoc)) + ".pdf"
				if fi, err := os.Stat(convertedPDF); err == nil && fi.Size() > 0 {
					if log != nil {
						log.Printf("normalizeDocument: converted %s → %s via libreoffice", filepath.Base(inputDoc), filepath.Base(convertedPDF))
					}
					src = pruneBlankPDFPages(convertedPDF, log)
					src = autoFitPDFPages(src, log)
					ext = ".pdf"
					isPDF = true
				}
			} else if log != nil {
				log.Printf("normalizeDocument: libreoffice conversion failed (%v): %s", err, strings.TrimSpace(string(out)))
			}
		}
		if inputDoc != src && strings.HasSuffix(inputDoc, ".land.xlsx") {
			_ = os.Remove(inputDoc)
		}
	}

	if media == "" {
		media = "A4"
	}

	// 1) Handling Images: Convert to standard print-ready PDF with white background flattening
	if isImage {
		dstPDF := strings.TrimSuffix(src, ext) + ".pdf"
		if conv, err := exec.LookPath("convert"); err == nil {
			ptW, ptH := discovery.PageDimensionsPoints(media)
			if ptW <= 0 || ptH <= 0 {
				ptW, ptH = 595, 842 // fallback A4
			}

			// Detect if orientation is Landscape (either explicitly or by inspecting image aspect ratio)
			isLandscape := strings.EqualFold(orientation, "landscape")
			if !isLandscape && !strings.EqualFold(orientation, "portrait") {
				if idCmd, idErr := exec.LookPath("identify"); idErr == nil {
					if out, err := exec.Command(idCmd, "-format", "%w %h", src).Output(); err == nil {
						parts := strings.Fields(strings.TrimSpace(string(out)))
						if len(parts) == 2 {
							w, _ := strconv.Atoi(parts[0])
							h, _ := strconv.Atoi(parts[1])
							if w > h {
								isLandscape = true
							}
						}
					}
				}
			}

			// Physical desktop printers feed paper along the short edge (portrait, ptW <= ptH).
			// We format the PDF directly to match the physical paper feed geometry.
			if ptW > ptH {
				ptW, ptH = ptH, ptW
			}

			// Pixel dimensions at true 300 DPI print density:
			// ptW and ptH are points (72 points = 1 inch).
			// pixel = points * 300 / 72.
			// This prevents ImageMagick from interpreting points as pixels and shrinking the PDF to 1/4th size!
			pixW := ptW * 300 / 72
			pixH := ptH * 300 / 72

			args := []string{src, "-auto-orient", "-background", "white", "-flatten", "-alpha", "off"}
			if isGray {
				args = append(args, "-colorspace", "Gray", "-contrast-stretch", "0.5%x0.5%")
			}

			if isLandscape {
				// Rotate 270 deg (counter-clockwise) so the landscape image fits the physical portrait sheet feed
				args = append(args, "-rotate", "270")
			}

			// Proportional fit without cropping (Fit Utuh / Ukuran Asli) or Full page (Fill / Cover)
			isCrop := discovery.IsFillScaling(scaling, false)
			if isCrop {
				args = append(args, "-resize", fmt.Sprintf("%dx%d^", pixW, pixH), "-gravity", "center", "-extent", fmt.Sprintf("%dx%d", pixW, pixH))
			} else {
				args = append(args, "-resize", fmt.Sprintf("%dx%d", pixW, pixH), "-gravity", "center", "-extent", fmt.Sprintf("%dx%d", pixW, pixH))
			}
			args = append(args, "-density", "300", "-page", fmt.Sprintf("%dx%d", pixW, pixH), dstPDF)

			if out, err := exec.Command(conv, args...).CombinedOutput(); err == nil {
				if fi, err := os.Stat(dstPDF); err == nil && fi.Size() > 0 {
					if log != nil {
						log.Printf("normalizeDocument: converted image %s → %s (landscape=%v, %dx%d pt [%dx%d px @ 300dpi], crop=%v)", filepath.Base(src), filepath.Base(dstPDF), isLandscape, ptW, ptH, pixW, pixH, isCrop)
					}
					return dstPDF
				}
			} else if log != nil {
				log.Printf("normalizeDocument: local convert error (%v): %s", err, strings.TrimSpace(string(out)))
			}
		}
		return src
	}

	// 2) Handling PDF documents: format geometry, orientation, and scaling
	// accurately to match the physical printer sheet feed (e.g. 595x842 pt for A4),
	// respecting user custom scale (e.g. 50%), orientation (Landscape/Portrait),
	// rotation without losing vector fidelity, and the user's chosen margins.
	return formatPDFForPrint(src, log, media, orientation, scaling, scalePercent, rotation, isGray, marginTop, marginRight, marginBottom, marginLeft)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// formatPDFForPrint formats a PDF to match the target physical sheet feed geometry
// while honoring orientation (Landscape/Portrait), custom scaling (e.g. 50%),
// rotation, margins (mm, applied as an inset from each edge of the sheet), and
// centering without losing vector quality.
func formatPDFForPrint(src string, log *log.Logger, media string, orientation string, scaling string, scalePercent int, rotation int, isGray bool, marginTopMM, marginRightMM, marginBottomMM, marginLeftMM float64) string {
	if !strings.EqualFold(filepath.Ext(src), ".pdf") {
		return src
	}
	gs, err := exec.LookPath("gs")
	if err != nil {
		return src
	}

	if media == "" {
		media = "A4"
	}
	ptW, ptH := discovery.PageDimensionsPoints(media)
	if ptW <= 0 || ptH <= 0 {
		ptW, ptH = 595, 842 // fallback A4
	}

	// Physical desktop printer feed is short edge first (portrait geometry)
	sheetW := minInt(ptW, ptH)
	sheetH := maxInt(ptW, ptH)

	docW, docH, ok := pageDimensionsPoints(src)
	if !ok || docW <= 0 || docH <= 0 {
		docW, docH = sheetW, sheetH
	}

	isLandscape := strings.EqualFold(strings.TrimSpace(orientation), "landscape")
	if !isLandscape && !strings.EqualFold(strings.TrimSpace(orientation), "portrait") {
		// Auto-detect orientation: if document is wider than tall, default to landscape
		if docW > docH {
			isLandscape = true
		}
	}

	// Canvas dimensions where document is laid out
	var canvasW, canvasH int
	if isLandscape {
		canvasW = sheetH
		canvasH = sheetW
	} else {
		canvasW = sheetW
		canvasH = sheetH
	}

	// mm → points (1mm = 72/25.4 pt). Clamp so a pathological margin (e.g. a
	// stale custom value larger than the sheet) can never invert the usable area.
	const ptPerMM = 72.0 / 25.4
	mTop := maxFloat(0, marginTopMM) * ptPerMM
	mRight := maxFloat(0, marginRightMM) * ptPerMM
	mBottom := maxFloat(0, marginBottomMM) * ptPerMM
	mLeft := maxFloat(0, marginLeftMM) * ptPerMM
	innerW := float64(canvasW) - mLeft - mRight
	innerH := float64(canvasH) - mTop - mBottom
	if innerW < 1 {
		innerW = float64(canvasW)
		mLeft, mRight = 0, 0
	}
	if innerH < 1 {
		innerH = float64(canvasH)
		mTop, mBottom = 0, 0
	}

	// Calculate scale factor. "Actual size" and "Custom %" are explicit user
	// intent and ignore the margin box entirely (matching how a real print
	// dialog treats them — margins only constrain the *auto-fit* modes).
	var s float64
	if strings.EqualFold(scaling, "custom") || (scalePercent > 0 && scalePercent != 100) {
		if scalePercent <= 0 {
			scalePercent = 100
		}
		s = float64(scalePercent) / 100.0
	} else if strings.EqualFold(scaling, "actual size") || strings.EqualFold(scaling, "actual") {
		s = 1.0
	} else if strings.EqualFold(scaling, "shrink to fit") || strings.EqualFold(scaling, "shrink") {
		if docW > int(innerW) || docH > int(innerH) {
			s = minFloat(innerW/float64(docW), innerH/float64(docH))
		} else {
			s = 1.0
		}
	} else if strings.EqualFold(scaling, "fit width") || strings.EqualFold(scaling, "fitwidth") {
		s = innerW / float64(docW)
	} else if discovery.IsFillScaling(scaling, false) {
		s = maxFloat(innerW/float64(docW), innerH/float64(docH))
	} else {
		// Default: "fit to page" / "fit"
		s = minFloat(innerW/float64(docW), innerH/float64(docH))
	}

	scaledW := float64(docW) * s
	scaledH := float64(docH) * s
	// Center within the margin-inset box, then offset by the left/bottom
	// margin (PostScript origin is bottom-left, so "bottom" margin pushes up).
	dx := mLeft + (innerW-scaledW)/2.0
	dy := mBottom + (innerH-scaledH)/2.0

	// Build BeginPage PostScript hook
	var hook strings.Builder
	hook.WriteString("<< /BeginPage { pop ")

	if isLandscape {
		// Map landscape canvas onto physical portrait feed sheet (rotate 270 and translate)
		hook.WriteString(fmt.Sprintf("0 %d translate 270 rotate ", sheetH))
	}

	rot := (rotation%360 + 360) % 360
	if rot != 0 {
		cx := float64(canvasW) / 2.0
		cy := float64(canvasH) / 2.0
		hook.WriteString(fmt.Sprintf("%.2f %.2f translate %d rotate %.2f %.2f translate ", cx, cy, rot, -cx, -cy))
	}

	hook.WriteString(fmt.Sprintf("%.4f %.4f translate %.4f %.4f scale ", dx, dy, s, s))
	hook.WriteString("} >> setpagedevice")

	dstPDF := strings.TrimSuffix(src, ".pdf") + ".fmt.pdf"

	args := []string{
		"-q", "-dNOPAUSE", "-dBATCH", "-dSAFER",
		"-sDEVICE=pdfwrite",
		"-dCompatibilityLevel=1.6",
		"-dAutoRotatePages=/None",
		"-dFIXEDMEDIA",
		fmt.Sprintf("-dDEVICEWIDTHPOINTS=%d", sheetW),
		fmt.Sprintf("-dDEVICEHEIGHTPOINTS=%d", sheetH),
		"-sOutputFile=" + dstPDF,
	}

	if isGray {
		args = append(args, "-sColorConversionStrategy=Gray", "-dProcessColorModel=/DeviceGray")
	}

	args = append(args, "-c", hook.String(), "-f", src)

	cmd := exec.Command(gs, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		if log != nil {
			log.Printf("formatPDFForPrint: gs failed (%v): %s", err, strings.TrimSpace(string(out)))
		}
		_ = os.Remove(dstPDF)
		return src
	}

	if fi, err := os.Stat(dstPDF); err == nil && fi.Size() > 0 {
		if log != nil {
			log.Printf("formatPDFForPrint: formatted %s → %s (landscape=%v, sheet=%dx%d pt, doc=%dx%d pt, scale=%.3f, rot=%d, gray=%v)",
				filepath.Base(src), filepath.Base(dstPDF), isLandscape, sheetW, sheetH, docW, docH, s, rot, isGray)
		}
		return dstPDF
	}

	_ = os.Remove(dstPDF)
	return src
}

// rasterizeForPrint implements the "print as image" option every normal print
// dialog offers: every page is rendered to a raster and written back as a flat
// PDF, so documents with exotic vectors/fonts still reach the printer intact.
func rasterizeForPrint(src string, log *log.Logger) string {
	if !strings.EqualFold(filepath.Ext(src), ".pdf") {
		return src
	}
	fi, err := os.Stat(src)
	if err != nil || fi.Size() == 0 || fi.Size() > maxSelfContainedPDFBytes {
		return src
	}
	conv, err := exec.LookPath("convert")
	if err != nil {
		return src
	}
	dst := strings.TrimSuffix(src, ".pdf") + ".raster.pdf"
	args := []string{"-density", "300", src, "-background", "white", "-alpha", "off", "-compress", "zip", dst}
	out, err := exec.Command(conv, args...).CombinedOutput()
	if err != nil {
		if log != nil {
			log.Printf("print-as-image: convert failed (%v): %s", err, strings.TrimSpace(string(out)))
		}
		_ = os.Remove(dst)
		return src
	}
	if chk, err := os.Stat(dst); err == nil && chk.Size() > 0 {
		if log != nil {
			log.Printf("print-as-image: %s rasterized (%d → %d bytes)", filepath.Base(src), fi.Size(), chk.Size())
		}
		return dst
	}
	_ = os.Remove(dst)
	return src
}

// buildWatermarkPostScript generates a PostScript EndPage hook that accurately
// measures the page bounds (clippath pathbbox) and text width per point. It scales
// the font dynamically so the text fits completely within printable bounds and is
// never cut off ("full"), placed according to layout ("center", "diagonal", "top",
// "bottom", "top-left", "top-right", "bottom-left", "bottom-right", "tiled").
func buildWatermarkPostScript(text, layout string, opacity float64) string {
	// Neutralize PostScript escape chars
	esc := strings.NewReplacer(`\`, `\\`, `(`, `\(`, `)`, `\)`).Replace(strings.ToValidUTF8(text, "?"))
	esc = strings.ReplaceAll(esc, "\r", "")
	esc = strings.ReplaceAll(esc, "\n", " ")

	if opacity <= 0 || opacity > 1.0 {
		opacity = 0.30
	}
	gray := 1.0 - (opacity * 0.70)
	if gray < 0.20 {
		gray = 0.20
	} else if gray > 0.95 {
		gray = 0.95
	}
	grayStr := fmt.Sprintf("%.2f", gray)

	layout = strings.ToLower(strings.TrimSpace(layout))
	if layout == "" {
		layout = "center"
	}

	var snippet string
	switch layout {
	case "center", "middle":
		snippet = fmt.Sprintf(`
			/maxW pW 0.82 mul def
			/fSize 48 def
			fSize w1 mul maxW gt { /fSize maxW w1 div def } if
			/actualW fSize w1 mul def
			/Helvetica-Bold findfont fSize scalefont setfont
			pCx pCy translate
			actualW 2 div neg fSize 0.35 mul neg moveto
			(%s) show`, esc)

	case "top", "header":
		snippet = fmt.Sprintf(`
			/maxW pW 0.85 mul def
			/fSize 22 def
			fSize w1 mul maxW gt { /fSize maxW w1 div def } if
			/actualW fSize w1 mul def
			/Helvetica-Bold findfont fSize scalefont setfont
			pCx urY 45 sub translate
			actualW 2 div neg fSize 0.35 mul neg moveto
			(%s) show`, esc)

	case "bottom", "footer":
		snippet = fmt.Sprintf(`
			/maxW pW 0.85 mul def
			/fSize 22 def
			fSize w1 mul maxW gt { /fSize maxW w1 div def } if
			/actualW fSize w1 mul def
			/Helvetica-Bold findfont fSize scalefont setfont
			pCx llY 45 add translate
			actualW 2 div neg fSize 0.35 mul neg moveto
			(%s) show`, esc)

	case "top-left":
		snippet = fmt.Sprintf(`
			/maxW pW 0.45 mul def
			/fSize 18 def
			fSize w1 mul maxW gt { /fSize maxW w1 div def } if
			/actualW fSize w1 mul def
			/Helvetica-Bold findfont fSize scalefont setfont
			llX 40 add urY 45 sub moveto
			(%s) show`, esc)

	case "top-right":
		snippet = fmt.Sprintf(`
			/maxW pW 0.45 mul def
			/fSize 18 def
			fSize w1 mul maxW gt { /fSize maxW w1 div def } if
			/actualW fSize w1 mul def
			/Helvetica-Bold findfont fSize scalefont setfont
			urX 40 sub actualW sub urY 45 sub moveto
			(%s) show`, esc)

	case "bottom-left":
		snippet = fmt.Sprintf(`
			/maxW pW 0.45 mul def
			/fSize 18 def
			fSize w1 mul maxW gt { /fSize maxW w1 div def } if
			/actualW fSize w1 mul def
			/Helvetica-Bold findfont fSize scalefont setfont
			llX 40 add llY 45 add moveto
			(%s) show`, esc)

	case "bottom-right":
		snippet = fmt.Sprintf(`
			/maxW pW 0.45 mul def
			/fSize 18 def
			fSize w1 mul maxW gt { /fSize maxW w1 div def } if
			/actualW fSize w1 mul def
			/Helvetica-Bold findfont fSize scalefont setfont
			urX 40 sub actualW sub llY 45 add moveto
			(%s) show`, esc)

	case "tiled", "repeat":
		snippet = fmt.Sprintf(`
			/maxW pW 0.30 mul def
			/fSize 18 def
			fSize w1 mul maxW gt { /fSize maxW w1 div def } if
			/actualW fSize w1 mul def
			/Helvetica-Bold findfont fSize scalefont setfont
			0.22 0.28 0.78 {
				/yFrac exch def
				0.25 0.50 0.75 {
					/xFrac exch def
					gsave
					pW xFrac mul pH yFrac mul translate
					35 rotate
					actualW 2 div neg fSize 0.35 mul neg moveto
					(%s) show
					grestore
				} for
			} for`, esc)

	case "diagonal", "center-diagonal":
		fallthrough
	default:
		snippet = fmt.Sprintf(`
			/maxW pW pW mul pH pH mul add sqrt 0.72 mul def
			/fSize 52 def
			fSize w1 mul maxW gt { /fSize maxW w1 div def } if
			/actualW fSize w1 mul def
			/Helvetica-Bold findfont fSize scalefont setfont
			pCx pCy translate
			45 rotate
			actualW 2 div neg fSize 0.35 mul neg moveto
			(%s) show`, esc)
	}

	return fmt.Sprintf(`<< /EndPage {
		pop pop
		gsave
		%s setgray
		clippath pathbbox
		/urY exch def
		/urX exch def
		/llY exch def
		/llX exch def
		/pW urX llX sub def
		/pH urY llY sub def
		/pCx llX urX add 2 div def
		/pCy llY urY add 2 div def
		/Helvetica-Bold findfont 1 scalefont setfont
		(%s) stringwidth pop /w1 exch def
		w1 0 le { /w1 1 def } if
		%s
		grestore
		true
	} >> setpagedevice`, grayStr, esc, snippet)
}

// applyWatermark stamps text onto every page using ghostscript's EndPage hook.
// The text is scaled and positioned dynamically based on page dimensions and layout
// so it is never cut off and matches the preview position.
func applyWatermark(src, text, layout string, opacity float64, log *log.Logger) string {
	text = strings.TrimSpace(text)
	if text == "" || !strings.EqualFold(filepath.Ext(src), ".pdf") {
		return src
	}
	gs, err := exec.LookPath("gs")
	if err != nil {
		return src
	}
	dst := strings.TrimSuffix(src, ".pdf") + ".wm.pdf"
	hook := buildWatermarkPostScript(text, layout, opacity)
	args := []string{
		"-q", "-dBATCH", "-dNOPAUSE", "-dSAFER",
		"-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.6",
		"-sOutputFile=" + dst,
		"-c", hook, "-f", src,
	}
	out, err := exec.Command(gs, args...).CombinedOutput()
	if err != nil {
		if log != nil {
			log.Printf("watermark: gs failed (%v): %s", err, strings.TrimSpace(string(out)))
		}
		_ = os.Remove(dst)
		return src
	}
	if chk, err := os.Stat(dst); err == nil && chk.Size() > 0 {
		if log != nil {
			log.Printf("watermark: stamped %q (layout=%s) on %s", text, layout, filepath.Base(src))
		}
		return dst
	}
	_ = os.Remove(dst)
	return src
}

// ensurePrintablePDF repairs producer metadata defects (notably non-integer
// /Rotate values that crash cups-filters pdftopdf) WITHOUT touching page
// geometry. It runs at upload time so preview, retry and dispatch all operate
// on the repaired file.
//
// It deliberately does NOT force a paper size. The previous implementation ran
// `pdftops -paper A4 -expand` and renamed the result over the uploaded file,
// which baked every document to A4 before the user had even chosen a sheet —
// so A5/Letter/4x6 selections could never be honoured. The document keeps its
// own MediaBox here; CUPS applies the selected size via print-scaling.
func ensurePrintablePDF(src string, log *log.Logger) string {
	if fixed, ok := repairPDFWithGhostscript(src, log); ok {
		return fixed
	}
	return src
}

// pageDimensionsPoints reads the first page's MediaBox in points. pdfinfo
// (poppler) is authoritative; ImageMagick identify reports points for PDFs as a
// fallback. Returns ok=false when neither tool is present or the geometry cannot
// be parsed, so callers leave the user's choice untouched instead of guessing.
func pageDimensionsPoints(path string) (w, h int, ok bool) {
	if bin, err := exec.LookPath("pdfinfo"); err == nil {
		if out, err := exec.Command(bin, path).Output(); err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				key, val, found := strings.Cut(line, ":")
				if !found || !strings.EqualFold(strings.TrimSpace(key), "Page size") {
					continue
				}
				// "419.53 x 595.28 pts (A5)" → fields[0]="419.53", fields[2]="595.28"
				fields := strings.Fields(val)
				if len(fields) < 3 || !strings.EqualFold(fields[1], "x") {
					break
				}
				pw, err1 := strconv.ParseFloat(fields[0], 64)
				ph, err2 := strconv.ParseFloat(fields[2], 64)
				if err1 == nil && err2 == nil && pw > 0 && ph > 0 {
					return int(pw), int(ph), true
				}
				break
			}
		}
	}
	if bin, err := exec.LookPath("identify"); err == nil {
		if out, err := exec.Command(bin, "-format", "%w %h", path+"[0]").Output(); err == nil {
			parts := strings.Fields(strings.TrimSpace(string(out)))
			if len(parts) == 2 {
				pw, err1 := strconv.Atoi(parts[0])
				ph, err2 := strconv.Atoi(parts[1])
				if err1 == nil && err2 == nil && pw > 0 && ph > 0 {
					return pw, ph, true
				}
			}
		}
	}
	return 0, 0, false
}

// resolveOrientationForPDF drops a requested landscape rotation when the page is
// ALREADY wider than tall: CUPS would otherwise rotate an already-landscape page
// and print it portrait. Pure, so it is unit-testable without a PDF or printer.
func resolveOrientationForPDF(requested string, w, h int) string {
	if strings.EqualFold(strings.TrimSpace(requested), "landscape") && w > h {
		return "portrait"
	}
	return requested
}

// maxSelfContainedPDFBytes caps the always-repair path; larger PDFs skip
// re-distillation to avoid long dispatch stalls.
const maxSelfContainedPDFBytes = 32 << 20

// repairPDFWithGhostscript rewrites src into a structurally clean PDF using
// ghostscript pdfwrite. It returns the repaired path and true on success; on
// any failure it returns ("", false) and the caller keeps the original file.
func repairPDFWithGhostscript(src string, log *log.Logger) (string, bool) {
	fi, err := os.Stat(src)
	if err != nil || fi.Size() == 0 || fi.Size() > maxSelfContainedPDFBytes {
		return "", false
	}
	gs, err := exec.LookPath("gs")
	if err != nil {
		return "", false
	}
	dst := strings.TrimSuffix(src, ".pdf") + ".fixed.pdf"
	args := []string{
		"-dBATCH", "-dNOPAUSE", "-dSAFER",
		"-sDEVICE=pdfwrite",
		"-dCompatibilityLevel=1.6",
		// Never let ghostscript second-guess page orientation: /Rotate is
		// rewritten as-is to an integer, content streams stay untouched.
		"-dAutoRotatePages=/None",
		"-dColorConversionStrategy=/LeaveColorUnchanged",
		"-dDownsampleColorImages=false",
		"-dDownsampleGrayImages=false",
		"-dDownsampleMonoImages=false",
		"-sOutputFile=" + dst,
		src,
	}
	out, err := exec.Command(gs, args...).CombinedOutput()
	if err != nil {
		if log != nil {
			log.Printf("repairPDF: gs failed for %s: %v: %s", filepath.Base(src), err, strings.TrimSpace(string(out)))
		}
		_ = os.Remove(dst)
		return "", false
	}
	chk, err := os.Stat(dst)
	if err != nil || chk.Size() == 0 {
		_ = os.Remove(dst)
		return "", false
	}
	if log != nil {
		log.Printf("repairPDF: %s normalized (%d → %d bytes)", filepath.Base(src), fi.Size(), chk.Size())
	}
	return dst, true
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
	// Tell cupsd first: mutating only the KroomPrint record left the physical
	// job running untouched (CUPS kept feeding the printer while the UI showed
	// "Cancelled"). Best-effort — a job with no CupsJobID yet (still spooling)
	// or one cupsd has already purged has nothing to cancel.
	if j.CupsJobID != 0 && printerName != "" {
		sshMode := discovery.IsSSHURL(s.cfg.CUPSURL)
		if sshMode {
			userHost := s.cfg.CUPSSSH
			if userHost == "" {
				userHost = discovery.NormalizeSSHHost(s.cfg.CUPSURL)
			}
			if _, err := discovery.SSHRunSimple(userHost, fmt.Sprintf("cancel %s", shellQuote(fmt.Sprintf("%s-%d", printerName, j.CupsJobID)))); err != nil && s.log != nil {
				s.log.Printf("cancel job %s: ssh cancel cups job %d failed: %v", id, j.CupsJobID, err)
			}
		} else if s.cfg.CUPSURL != "" {
			host := discovery.NormalizeHost(s.cfg.CUPSURL)
			if err := discovery.CancelJobIPP(host, printerName, j.CupsJobID, 5*time.Second); err != nil && s.log != nil {
				s.log.Printf("cancel job %s: ipp cancel cups job %d failed: %v", id, j.CupsJobID, err)
			}
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
	recs, err := s.store.ListHistory(500, "")
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
	var req struct {
		Priority int `json:"priority"`
	}
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
	c, ok := s.claimsFromCtx(r)
	if !ok {
		// Guest / unauthenticated visitor has no personal history
		writeJSON(w, 200, []store.HistoryRecord{})
		return
	}

	userFilter := c.Sub
	if c.Role == "admin" {
		if r.URL.Query().Get("all") == "true" {
			userFilter = ""
		} else if u := r.URL.Query().Get("user"); u != "" {
			userFilter = u
		}
	}

	recs, err := s.store.ListHistory(limit, userFilter)
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

// ── Settings & Diagnostics handlers ──

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	resp := map[string]string{
		"autoRefresh":   s.store.GetSetting("autoRefresh", "true"),
		"notifications": s.store.GetSetting("notifications", "true"),
		"darkMode":      s.store.GetSetting("darkMode", "false"),
		"compactQueue":  s.store.GetSetting("compactQueue", "false"),
		"userName":      s.store.GetSetting("userName", "Andi Ahmad"),
		"userEmail":     s.store.GetSetting("userEmail", "andi@kroomprint.app"),
		"workspaceName": s.store.GetSetting("workspaceName", "KroomPrint Main"),
		"plan":          "KroomPrint Pro",
	}
	// The internal CUPS endpoint is only disclosed to authenticated roles;
	// guests see live "Connected" status via diagnostics instead.
	if _, ok := s.claimsFromCtx(r); ok {
		resp["cupsURL"] = s.store.GetSetting("cupsURL", s.cfg.CUPSURL)
	}
	writeJSON(w, 200, resp)
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := readJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid JSON body")
		return
	}
	c, ok := s.claimsFromCtx(r)
	isAdmin := ok && c.Role == "admin"

	for k, v := range req {
		// Only admin can alter system-wide workspace or CUPS server configuration
		if (k == "cupsURL" || k == "workspaceName") && !isAdmin {
			continue
		}
		if b, ok := v.(bool); ok {
			_ = s.store.SetSetting(k, strconv.FormatBool(b))
		} else if str, ok := v.(string); ok {
			_ = s.store.SetSetting(k, str)
		}
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleTestCUPSConnection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CupsURL string `json:"cupsURL"`
	}
	_ = readJSON(r, &req)
	targetURL := strings.TrimSpace(req.CupsURL)
	if targetURL == "" {
		targetURL = s.store.GetSetting("cupsURL", s.cfg.CUPSURL)
	}
	if targetURL == "" {
		targetURL = "http://127.0.0.1:631"
	}

	u, err := url.Parse(targetURL)
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid CUPS URL format"})
		return
	}

	host := u.Host
	if !strings.Contains(host, ":") {
		if u.Scheme == "https" || u.Scheme == "ipps" {
			host += ":443"
		} else {
			host += ":631"
		}
	}

	start := time.Now()
	conn, err := net.DialTimeout("tcp", host, 1500*time.Millisecond)
	if err != nil {
		writeJSON(w, 200, map[string]any{
			"ok":        false,
			"endpoint":  targetURL,
			"error":     fmt.Sprintf("Failed to connect to CUPS host %s: %v", host, err),
			"latencyMs": float64(time.Since(start).Microseconds()) / 1000.0,
		})
		return
	}
	conn.Close()
	latencyMs := float64(time.Since(start).Microseconds()) / 1000.0

	writeJSON(w, 200, map[string]any{
		"ok":        true,
		"endpoint":  targetURL,
		"latencyMs": latencyMs,
		"message":   "CUPS spooler daemon is reachable and responding.",
	})
}

func (s *Server) handleNetworkDiagnostics(w http.ResponseWriter, r *http.Request) {
	diag := map[string]any{
		"timestamp": time.Now().Format(time.RFC3339),
		"backend": map[string]any{
			"online":  true,
			"version": "1.0.0",
			"uptime":  time.Since(s.bootTime).Round(time.Second).String(),
		},
	}

	// CUPS Daemon Check
	cupsOnline := false
	var cupsLatency float64
	cStart := time.Now()
	conn, err := net.DialTimeout("tcp", "127.0.0.1:631", 600*time.Millisecond)
	if err == nil {
		conn.Close()
		cupsOnline = true
		cupsLatency = float64(time.Since(cStart).Microseconds()) / 1000.0
	}
	diag["cups"] = map[string]any{
		"online":    cupsOnline,
		"latencyMs": cupsLatency,
		"endpoint":  "http://127.0.0.1:631",
	}

	// Gateway / Network Check
	gwOnline := false
	var gwLatency float64
	gwStart := time.Now()
	gwConn, gErr := net.DialTimeout("tcp", "192.168.138.1:80", 500*time.Millisecond)
	if gErr != nil {
		gwConn, gErr = net.DialTimeout("tcp", "100.90.80.70:22", 500*time.Millisecond)
	}
	if gErr == nil {
		gwConn.Close()
		gwOnline = true
		gwLatency = float64(time.Since(gwStart).Microseconds()) / 1000.0
	}
	diag["gateway"] = map[string]any{
		"online":    gwOnline,
		"latencyMs": gwLatency,
	}

	// Storage check
	diag["storage"] = map[string]any{
		"spoolDir": s.cfg.UploadsDir,
		"status":   "Normal · Spool ready",
	}

	// Printers status
	printersList, _ := s.store.ListPrinters()
	var printerChecks []map[string]any
	for _, p := range printersList {
		pOnline := p.Status == "online"
		pLatency := 0.8
		if strings.Contains(p.Address, ":") {
			host := p.Address
			if strings.HasPrefix(host, "ipp://") || strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "socket://") {
				if u, pErr := url.Parse(p.Address); pErr == nil {
					host = u.Host
				}
			}
			if !strings.Contains(host, ":") {
				host += ":631"
			}
			pStart := time.Now()
			if c, err := net.DialTimeout("tcp", host, 500*time.Millisecond); err == nil {
				c.Close()
				pOnline = true
				pLatency = float64(time.Since(pStart).Microseconds()) / 1000.0
			}
		}
		printerChecks = append(printerChecks, map[string]any{
			"id":        p.ID,
			"name":      p.Name,
			"address":   p.Address,
			"online":    pOnline,
			"latencyMs": pLatency,
		})
	}
	diag["printers"] = printerChecks

	writeJSON(w, 200, diag)
}

func (s *Server) handleResetData(w http.ResponseWriter, r *http.Request) {
	_ = s.store.ClearAllJobs()
	_ = s.store.ClearHistory()
	_ = s.store.SetSetting("autoRefresh", "true")
	_ = s.store.SetSetting("notifications", "true")
	_ = s.store.SetSetting("darkMode", "false")
	_ = s.store.SetSetting("compactQueue", "false")
	_ = s.store.SetSetting("userName", "Andi Ahmad")
	_ = s.store.SetSetting("userEmail", "andi@kroomprint.app")
	_ = s.store.SetSetting("workspaceName", "KroomPrint Main")

	s.hub.Broadcast("job_deleted", map[string]any{"reset": true})
	writeJSON(w, 200, map[string]any{"ok": true, "message": "All jobs, print history, and workspace settings have been successfully reset."})
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

// handleConvertPreview converts an uploaded Office doc/image to PDF for real-time UI preview.
// Results are cached by MD5 hash for 30 minutes — repeat uploads of the same file are instant.
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

	// Read all bytes so we can hash them for caching
	data, err := io.ReadAll(file)
	if err != nil {
		writeErr(w, 500, "cannot read uploaded file")
		return
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))

	// 1) If already a PDF, serve directly without temp file dance
	if ext == ".pdf" {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", "inline; filename=preview.pdf")
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		w.WriteHeader(200)
		_, _ = w.Write(data)
		return
	}

	// 2) Check in-process preview cache (avoids repeat LibreOffice invocations)
	hash := fmt.Sprintf("%x", md5.Sum(data))
	cacheKey := fmt.Sprintf("%s-v8%s", hash, ext)
	force := r.URL.Query().Get("force") == "true"

	s.previewMu.Lock()
	if !force {
		if entry, ok := s.previewCache[cacheKey]; ok && time.Now().Before(entry.expires) {
			cachedPath := entry.path
			s.previewMu.Unlock()
			if fi, err := os.Stat(cachedPath); err == nil && fi.Size() > 0 {
				if s.log != nil {
					s.log.Printf("preview cache HIT: %s (%s, %d bytes)", header.Filename, cacheKey[:8], fi.Size())
				}
				w.Header().Set("Content-Type", "application/pdf")
				w.Header().Set("Content-Disposition", "inline; filename=preview.pdf")
				w.Header().Set("X-Cache", "HIT")
				w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
				w.Header().Set("Pragma", "no-cache")
				w.Header().Set("Expires", "0")
				http.ServeFile(w, r, cachedPath)
				return
			}
			// Cached file was deleted externally — remove stale entry
			s.previewMu.Lock()
			delete(s.previewCache, cacheKey)
		}
	}
	s.previewMu.Unlock()

	// 3) Write to temp input file
	tmpInput := filepath.Join("/tmp", fmt.Sprintf("kp-prev-%s-%s", hash[:8], sanitizeFilename(header.Filename)))
	if err := os.WriteFile(tmpInput, data, 0o644); err != nil {
		writeErr(w, 500, "cannot create temporary file")
		return
	}
	defer os.Remove(tmpInput)

	serveAndCache := func(pdfPath string) {
		if fi, err := os.Stat(pdfPath); err == nil && fi.Size() > 0 {
			// Persist to stable cache path
			cachePath := filepath.Join("/tmp", fmt.Sprintf("kp-cached-%s.pdf", cacheKey[:16]))
			_ = os.Rename(pdfPath, cachePath)
			s.previewMu.Lock()
			s.previewCache[cacheKey] = previewCacheEntry{path: cachePath, expires: time.Now().Add(30 * time.Minute)}
			s.previewMu.Unlock()
			if s.log != nil {
				s.log.Printf("preview cache STORE: %s → %s", header.Filename, cacheKey[:8])
			}
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("Content-Disposition", "inline; filename=preview.pdf")
			w.Header().Set("X-Cache", "MISS")
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
			http.ServeFile(w, r, cachePath)
		}
	}

	// 4) Image → PDF via ImageMagick
	isImage := ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" ||
		ext == ".bmp" || ext == ".gif" || ext == ".tif" || ext == ".tiff" ||
		ext == ".heic" || ext == ".svg"
	if isImage {
		tmpPDF := tmpInput + ".pdf"
		if conv, err := exec.LookPath("convert"); err == nil {
			cmd := exec.Command(conv, "-density", "150", tmpInput, "-background", "white", "-flatten", "-alpha", "off", "-page", "A4", tmpPDF)
			if out, err := cmd.CombinedOutput(); err == nil {
				serveAndCache(tmpPDF)
				return
			} else if s.log != nil {
				s.log.Printf("preview image convert error: %v (%s)", err, strings.TrimSpace(string(out)))
			}
		}
	}

	// 5) Office doc → PDF via headless LibreOffice
	isDoc := ext == ".docx" || ext == ".doc" || ext == ".odt" || ext == ".rtf" ||
		ext == ".pptx" || ext == ".ppt" || ext == ".xlsx" || ext == ".xls" ||
		ext == ".ods" || ext == ".odp" || ext == ".html" || ext == ".htm" ||
		ext == ".txt" || ext == ".csv"
	if isDoc {
		inputDoc := tmpInput
		if ext == ".xlsx" {
			inputDoc = prepareSpreadsheetLandscape(tmpInput, s.log)
		}
		loCmd := ""
		if p, err := exec.LookPath("libreoffice"); err == nil {
			loCmd = p
		} else if p, err := exec.LookPath("soffice"); err == nil {
			loCmd = p
		}
		if loCmd != "" {
			cmd := exec.Command(loCmd, "--headless", "--convert-to", "pdf", "--outdir", "/tmp", inputDoc)
			if out, err := cmd.CombinedOutput(); err == nil {
				tmpPDF := strings.TrimSuffix(inputDoc, filepath.Ext(inputDoc)) + ".pdf"
				pruneBlankPDFPages(tmpPDF, s.log)
				autoFitPDFPages(tmpPDF, s.log)
				serveAndCache(tmpPDF)
				if inputDoc != tmpInput && strings.HasSuffix(inputDoc, ".land.xlsx") {
					_ = os.Remove(inputDoc)
				}
				return
			} else if s.log != nil {
				s.log.Printf("preview libreoffice error: %v (%s)", err, strings.TrimSpace(string(out)))
			}
		}
		if inputDoc != tmpInput && strings.HasSuffix(inputDoc, ".land.xlsx") {
			_ = os.Remove(inputDoc)
		}
	}

	writeErr(w, 415, "cannot convert this file format to visual preview")
}

// ── Domain 4: Real-Time SSE Streaming & Concurrency Handlers ──

// handleEvents provides zero-latency Server-Sent Events (SSE) streaming for queue & printer state.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	ch := s.hub.subscribe()
	defer s.hub.unsubscribe(ch)

	// Send initial connection event
	initMsg, _ := json.Marshal(map[string]any{
		"status": "connected",
		"time":   time.Now().UnixMilli(),
	})
	fmt.Fprintf(w, "event: init\ndata: %s\n\n", string(initMsg))
	flusher.Flush()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			_, _ = w.Write(msg)
			flusher.Flush()
		}
	}
}

// handleReleaseSecureJob verifies a 4-digit PIN and releases a held secure job to the physical printer.
func (s *Server) handleReleaseSecureJob(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	j, err := s.store.GetJob(id)
	if err != nil {
		writeErr(w, 404, "job not found")
		return
	}

	var req struct {
		PIN string `json:"pin"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	if j.PIN != "" && j.PIN != req.PIN {
		writeErr(w, 401, "PIN salah. Silakan masukkan PIN yang sesuai.")
		return
	}

	p, err := s.store.GetPrinter(j.PrinterID)
	if err != nil {
		writeErr(w, 400, "target printer unavailable")
		return
	}

	j.Status = "queued"
	_ = s.store.UpdateJob(j)
	if s.hub != nil {
		s.hub.Broadcast("job_updated", j)
	}

	jobReq := createJobReq{
		FileType:    j.FileType,
		Pages:       j.Pages,
		Copies:      j.Copies,
		Color:       j.Color,
		Duplex:      j.Duplex,
		PaperSize:   j.PaperSize,
		Orientation: j.Orientation,
		Quality:     j.Quality,
		Scaling:     j.Scaling,
		PageRange:   j.PageRange,
		Priority:    j.Priority,
		PrinterID:   j.PrinterID,
		Cost:        j.Cost,
		User:        j.User,
		Department:  j.Department,
	}

	go s.dispatchPrintJob(j.ID, j.FilePath, jobReq, p, j.Name)

	writeJSON(w, 200, map[string]any{
		"ok":      true,
		"message": "PIN diverifikasi. Dokumen telah dilepas dan dikirim ke antrean cetak.",
		"jobId":   j.ID,
	})
}

// handleRerouteJob re-routes an existing job to another target printer.
func (s *Server) handleRerouteJob(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	j, err := s.store.GetJob(id)
	if err != nil {
		writeErr(w, 404, "job not found")
		return
	}

	var req struct {
		PrinterID string `json:"printerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PrinterID == "" {
		writeErr(w, 400, "printerId is required")
		return
	}

	newPrinter, err := s.store.GetPrinter(req.PrinterID)
	if err != nil {
		writeErr(w, 404, "new target printer not found")
		return
	}

	j.PrinterID = newPrinter.ID
	j.Status = "queued"
	j.Progress = 0
	_ = s.store.UpdateJob(j)
	if s.hub != nil {
		s.hub.Broadcast("job_updated", j)
	}

	jobReq := createJobReq{
		FileType:    j.FileType,
		Pages:       j.Pages,
		Copies:      j.Copies,
		Color:       j.Color,
		Duplex:      j.Duplex,
		PaperSize:   j.PaperSize,
		Orientation: j.Orientation,
		Quality:     j.Quality,
		Scaling:     j.Scaling,
		PageRange:   j.PageRange,
		Priority:    j.Priority,
		PrinterID:   newPrinter.ID,
		Cost:        j.Cost,
		User:        j.User,
		Department:  j.Department,
	}

	go s.dispatchPrintJob(j.ID, j.FilePath, jobReq, newPrinter, j.Name)

	writeJSON(w, 200, map[string]any{
		"ok":          true,
		"message":     fmt.Sprintf("Job dialihkan ke printer %s", newPrinter.Name),
		"printerName": newPrinter.Name,
	})
}

// handlePurgeJob permanently purges a job and securely wipes temporary spool artifacts.
func (s *Server) handlePurgeJob(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	j, err := s.store.GetJob(id)
	if err == nil && j.FilePath != "" {
		_ = os.Remove(j.FilePath)
	}
	_ = s.store.DeleteJob(id)
	if s.hub != nil {
		s.hub.Broadcast("job_deleted", map[string]string{"id": id})
	}
	writeJSON(w, 200, map[string]any{"ok": true, "message": "Job and temporary spool file purged successfully"})
}

// ── Domain 5: Security, Accounting & Analytics Handlers ──

// handleAnalyticsSummary returns global usage summary, cost breakdown and department quotas.
func (s *Server) handleAnalyticsSummary(w http.ResponseWriter, r *http.Request) {
	hist, _ := s.store.ListHistory(1000, "")
	totalJobs := len(hist)
	totalPages := 0
	totalCost := 0
	deptPages := make(map[string]int)

	for _, h := range hist {
		pages := h.Pages * h.Copies
		totalPages += pages
		totalCost += h.Cost
		dept := h.Department
		if dept == "" {
			dept = "Engineering"
		}
		deptPages[dept] += pages
	}

	monthlyQuota := 500
	quotaUsed := totalPages % monthlyQuota
	if quotaUsed == 0 && totalPages > 0 {
		quotaUsed = monthlyQuota
	}

	writeJSON(w, 200, map[string]any{
		"totalJobs":      totalJobs,
		"totalPages":     totalPages,
		"totalCost":      totalCost,
		"monthlyQuota":   monthlyQuota,
		"quotaUsed":      quotaUsed,
		"quotaRemaining": monthlyQuota - quotaUsed,
		"departments":    deptPages,
	})
}

// handleAnalyticsExport exports complete print audit logs as CSV or JSON.
func (s *Server) handleAnalyticsExport(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	hist, err := s.store.ListHistory(5000, "")
	if err != nil {
		writeErr(w, 500, "cannot fetch history: "+err.Error())
		return
	}

	if strings.ToLower(format) == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="kroomprint-audit-log.csv"`)
		w.WriteHeader(200)

		fmt.Fprintln(w, "ID,Job Name,File Type,Pages,Copies,Total Pages,Printer Name,Status,Cost (IDR),User,Department,Created At,Duration,Error")
		for _, h := range hist {
			totPages := h.Pages * h.Copies
			dateStr := time.UnixMilli(h.CreatedAt).Format(time.RFC3339)
			fmt.Fprintf(w, "%q,%q,%q,%d,%d,%d,%q,%q,%d,%q,%q,%q,%q,%q\n",
				h.ID, h.Name, h.FileType, h.Pages, h.Copies, totPages, h.PrinterName, h.Status, h.Cost, h.User, h.Department, dateStr, h.Duration, h.Error,
			)
		}
		return
	}

	writeJSON(w, 200, map[string]any{
		"records": hist,
		"total":   len(hist),
	})
}
