package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"kroomprint/backend/internal/api"
	"kroomprint/backend/internal/config"
	"kroomprint/backend/internal/scheduler"
	"kroomprint/backend/internal/store"
)

func main() {
	cfg := config.Load()
	logger := log.New(os.Stdout, "[kroomprint] ", log.LstdFlags)

	// Database
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		logger.Fatalf("open store: %v", err)
	}
	defer st.Close()

	// Demo data & simulated activity only when KROOM_DEMO=1
	if cfg.DemoMode {
		if err := seed(st); err != nil {
			logger.Printf("seed: %v", err)
		}
	}

	// Scheduler advances job progress only in demo mode.
	// In real mode, printers/jobs come from real devices and user actions.
	var sched *scheduler.Scheduler
	if cfg.DemoMode {
		sched = scheduler.New(st, logger)
		sched.Start()
		defer sched.Stop()
	}

	// HTTP server + real CUPS status sync (ssh:// or http://)
	apiSrv := api.New(cfg, st, logger)
	apiSrv.StartCupsPoller()
	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: apiSrv.Handler(),
	}

	go func() {
		logger.Printf("KroomPrint backend listening on %s (db: %s)", cfg.Addr, cfg.DBPath)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatalf("listen: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Println("shutting down…")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

// seed inserts demo printers/jobs/history the first time the DB is empty.
func seed(st *store.Store) error {
	printers, _ := st.ListPrinters()
	if len(printers) > 0 {
		return nil
	}

	// Demo printers
	demoPrinters := []struct {
		name, brand, model, conn, addr, mac string
		toner, paper                        int
		speed                               string
		duplex, color                       bool
		sizes, quals                        []string
	}{
		{"Kroom Office HP", "HP", "LaserJet Pro M404dn", "Network", "192.168.1.42", "3C:52:82:1E:9A:11", 78, 120, "40 ppm", true, false,
			[]string{"A4", "A5", "A3", "Letter", "Legal"}, []string{"Draft", "Standard", "High"}},
		{"Studio Inkjet", "Epson", "EcoTank L3250", "USB", "USB-002", "—", 62, 85, "10 ppm", true, true,
			[]string{"A4", "A5", "A6", "Letter", "4x6 Photo", "5x7 Photo"}, []string{"Draft", "Standard", "High", "Photo"}},
		{"Living Room Canon", "Canon", "PIXMA TS3350", "WiFi", "192.168.1.77", "84:4F:12:2C:08:33", 41, 60, "7.7 ppm", true, true,
			[]string{"A4", "A5", "B5", "Letter", "4x6 Photo"}, []string{"Draft", "Standard", "High"}},
		{"Workshop Laser", "Brother", "HL-L2350DW", "Network", "192.168.1.105", "B0:C5:54:9F:41:77", 12, 0, "32 ppm", true, false,
			[]string{"A4", "A5", "A6", "Letter", "Legal"}, []string{"Draft", "Standard", "High"}},
	}
	for i, d := range demoPrinters {
		_, err := st.CreatePrinter(store.Printer{
			Name:       d.name,
			Brand:      d.brand,
			Model:      d.model,
			Connection: d.conn,
			Address:    d.addr,
			MAC:        d.mac,
			Status:     "online",
			Enabled:    true,
			Paused:     i == 2,
			IsDefault:  i == 0,
			Toner:      d.toner,
			Paper:      d.paper,
			Speed:      d.speed,
			Caps: store.Capabilities{
				PaperSizes:   d.sizes,
				Qualities:    d.quals,
				Scalings:     []string{"Fit to page", "Shrink to fit", "Actual size", "Custom"},
				Orientations: []string{"Portrait", "Landscape"},
				Duplex:       d.duplex,
				Color:        d.color,
				MaxCopies:    999,
			},
		})
		if err != nil {
			return err
		}
	}

	// Workshop Laser is offline & disabled
	if err := st.SetPrinterStatusByName("Workshop Laser", "offline"); err != nil {
		return err
	}
	_ = st.SetPrinterEnabledByName("Workshop Laser", false)

	// Demo jobs
	jobs := []store.Job{
		{Name: "quarterly-report.pdf", FileType: "PDF", Pages: 24, Copies: 1, Color: false, Duplex: true, PaperSize: "A4", Orientation: "Portrait", Quality: "Standard", Scaling: "Fit to page", Priority: 3, Status: "printing", Progress: 46, Size: "3.2 MB", PrinterID: mustPrinterID(st, "Kroom Office HP")},
		{Name: "design-mockup.png", FileType: "PNG", Pages: 1, Copies: 2, Color: true, Duplex: false, PaperSize: "A4", Orientation: "Portrait", Quality: "High", Scaling: "Fit to page", Priority: 2, Status: "queued", Size: "8.4 MB", PrinterID: mustPrinterID(st, "Studio Inkjet")},
		{Name: "meeting-notes.txt", FileType: "TXT", Pages: 3, Copies: 1, Color: false, Duplex: true, PaperSize: "A4", Orientation: "Portrait", Quality: "Draft", Scaling: "Shrink to fit", Priority: 1, Status: "queued", Size: "12 KB", PrinterID: mustPrinterID(st, "Kroom Office HP")},
		{Name: "invoice-jan.pdf", FileType: "PDF", Pages: 2, Copies: 1, Color: false, Duplex: false, PaperSize: "A4", Orientation: "Portrait", Quality: "Standard", Scaling: "Fit to page", Priority: 4, Status: "paused", Progress: 18, Size: "410 KB", PrinterID: mustPrinterID(st, "Living Room Canon")},
	}
	for _, j := range jobs {
		if _, err := st.CreateJob(j); err != nil {
			return err
		}
	}

	// Demo history
	now := time.Now().UnixMilli()
	hist := []store.HistoryRecord{
		{Name: "terms-of-service.pdf", FileType: "PDF", Pages: 12, Copies: 1, PrinterName: "Kroom Office HP", Status: "completed", CreatedAt: now - 2*3600*1000, Duration: "38s"},
		{Name: "team-photo.jpg", FileType: "JPG", Pages: 1, Copies: 3, PrinterName: "Studio Inkjet", Status: "completed", CreatedAt: now - 5*3600*1000, Duration: "24s"},
		{Name: "presentation-v2.pptx", FileType: "PPTX", Pages: 41, Copies: 1, PrinterName: "Living Room Canon", Status: "failed", CreatedAt: now - 26*3600*1000, Duration: "—"},
		{Name: "resume-2026.pdf", FileType: "PDF", Pages: 2, Copies: 1, PrinterName: "Kroom Office HP", Status: "completed", CreatedAt: now - 30*3600*1000, Duration: "9s"},
		{Name: "receipt.txt", FileType: "TXT", Pages: 1, Copies: 1, PrinterName: "Studio Inkjet", Status: "cancelled", CreatedAt: now - 49*3600*1000, Duration: "—"},
	}
	for _, h := range hist {
		if err := st.AddHistory(h); err != nil {
			return err
		}
	}

	return nil
}

func mustPrinterID(st *store.Store, name string) string {
	printers, _ := st.ListPrinters()
	for _, p := range printers {
		if p.Name == name {
			return p.ID
		}
	}
	return ""
}

var _ = context.Background // keep import
