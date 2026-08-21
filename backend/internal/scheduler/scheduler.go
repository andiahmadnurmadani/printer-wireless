package scheduler

import (
	"log"
	"math/rand"
	"time"

	"kroomprint/backend/internal/store"
)

// Scheduler advances print jobs and simulates live network behaviour.
type Scheduler struct {
	store *store.Store
	log   *log.Logger
	stop  chan struct{}
}

// New creates a scheduler.
func New(s *store.Store, logger *log.Logger) *Scheduler {
	return &Scheduler{store: s, log: logger, stop: make(chan struct{})}
}

// Start begins background loops: job progress + incoming demo jobs + printer jitter.
func (s *Scheduler) Start() {
	go s.loopJobProgress()
	go s.loopIncomingJobs()
	go s.loopPrinterStatus()
}

// Stop halts all loops.
func (s *Scheduler) Stop() { close(s.stop) }

// loopJobProgress advances queued/printing jobs every 2.5s.
func (s *Scheduler) loopJobProgress() {
	tick := time.NewTicker(2500 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-tick.C:
			s.advance()
		}
	}
}

func (s *Scheduler) advance() {
	jobs, err := s.store.ListJobs()
	if err != nil {
		return
	}
	for _, j := range jobs {
		switch j.Status {
		case "queued":
			j.Progress = 3
			j.Status = "printing"
			_ = s.store.UpdateJob(j)
		case "printing":
			j.Progress += 3 + rand.Intn(5)
			if j.Progress >= 100 {
				_ = s.store.CompleteJobToHistory(j, "completed", "")
			} else {
				_ = s.store.UpdateJob(j)
			}
		}
	}
}

// loopIncomingJobs simulates print requests arriving from other devices.
func (s *Scheduler) loopIncomingJobs() {
	docs := []struct {
		name string
		typ  string
		pages int
		size string
	}{
		{"meeting-notes.pdf", "PDF", 6, "1.2 MB"},
		{"product-specs.pdf", "PDF", 14, "2.8 MB"},
		{"company-brochure.pdf", "PDF", 8, "4.1 MB"},
		{"sketch-design.png", "PNG", 1, "6.3 MB"},
		{"photo-export.jpg", "JPG", 1, "3.5 MB"},
		{"script.txt", "TXT", 2, "8 KB"},
		{"annual-report.xlsx", "XLSX", 12, "900 KB"},
		{"invoice-feb.pdf", "PDF", 2, "310 KB"},
	}
	tick := time.NewTicker(16 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-tick.C:
			printers, err := s.store.ListPrinters()
			if err != nil {
				continue
			}
			var online []store.Printer
			for _, p := range printers {
				if p.Enabled && p.Status == "online" {
					online = append(online, p)
				}
			}
			if len(online) == 0 {
				continue
			}
			doc := docs[rand.Intn(len(docs))]
			pr := online[rand.Intn(len(online))]
			_, _ = s.store.CreateJob(store.Job{
				Name:        doc.name,
				FileType:    doc.typ,
				Pages:       doc.pages,
				Copies:      1 + rand.Intn(2),
				Color:       pr.Caps.Color && rand.Intn(2) == 0,
				Duplex:      pr.Caps.Duplex && rand.Intn(2) == 0,
				PaperSize:   "A4",
				Orientation: "Portrait",
				Quality:     "Standard",
				Scaling:     "Fit to page",
				Priority:    1 + rand.Intn(5),
				Status:      "queued",
				Size:        doc.size,
				PrinterID:   pr.ID,
			})
			if s.log != nil {
				s.log.Printf("incoming job %s -> %s", doc.name, pr.Name)
			}
		}
	}
}

// loopPrinterStatus adds subtle toner/paper jitter so the UI feels alive.
func (s *Scheduler) loopPrinterStatus() {
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-tick.C:
			printers, err := s.store.ListPrinters()
			if err != nil {
				continue
			}
			for _, p := range printers {
				if p.Status != "online" {
					continue
				}
				p.Toner = clamp(p.Toner+rand.Intn(5)-2, 0, 100)
				p.Paper = clamp(p.Paper+rand.Intn(3)-1, 0, 500)
				_ = s.store.UpdatePrinter(p)
			}
		}
	}
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
