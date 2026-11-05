package api

import (
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"kroomprint/backend/internal/discovery"
	"kroomprint/backend/internal/store"
)

// alertText maps CUPS printer-state-reasons prefixes to operator messages.
var alertText = []struct{ prefix, msg string }{
	{"media-jam", "Kertas macet di printer"},
	{"media-empty", "Kertas habis, isi baki kertas"},
	{"media-needed", "Kertas habis, isi baki kertas"},
	{"door-open", "Tutup printer terbuka"},
	{"cover-open", "Tutup printer terbuka"},
	{"marker-supply-empty", "Tinta habis"},
	{"offline-report", "Printer tidak merespons (cek kabel USB / daya)"},
	{"paused", "Antrean printer sedang dijeda"},
}

// printerAlerts returns the live CUPS state-reasons for a local-CUPS printer.
// Empty when CUPS is not configured, SSH mode, or the query fails.
func (s *Server) printerAlerts(p store.Printer) []string {
	if s.cfg.CUPSURL == "" || discovery.IsSSHURL(s.cfg.CUPSURL) {
		return nil
	}
	reasons, _, err := discovery.PrinterStateIPP(discovery.NormalizeHost(s.cfg.CUPSURL), cupsPrinterName(p), 3*time.Second)
	if err != nil {
		return nil
	}
	return reasons
}

func hasAlert(reasons []string, prefixes ...string) bool {
	for _, r := range reasons {
		for _, pf := range prefixes {
			if strings.HasPrefix(r, pf) {
				return true
			}
		}
	}
	return false
}

// alertMessage returns the first known alert as text ("" when none). Reasons
// ending in "-report" from the driver are informational except offline-report.
func alertMessage(reasons []string) string {
	for _, a := range alertText {
		if hasAlert(reasons, a.prefix) {
			return a.msg
		}
	}
	return ""
}

// preflightPrinter refuses a print the printer cannot take right now, so the
// user sees why instead of a job that sits in the queue forever. "" = OK.
// Only local CUPS is checked; it never blocks when the check itself fails.
func (s *Server) preflightPrinter(p store.Printer) string {
	if s.cfg.CUPSURL == "" || discovery.IsSSHURL(s.cfg.CUPSURL) {
		return ""
	}
	queue := cupsPrinterName(p)
	reasons, accepting, err := discovery.PrinterStateIPP(discovery.NormalizeHost(s.cfg.CUPSURL), queue, 3*time.Second)
	if err != nil {
		return ""
	}
	if !accepting {
		return "Printer tidak menerima job (antrean CUPS ditolak). Hubungi admin."
	}
	if hasAlert(reasons, "media-jam", "door-open", "cover-open", "media-empty", "media-needed", "marker-supply-empty") {
		return alertMessage(reasons)
	}
	// USB printers: the CUPS queue stays "idle" when unplugged, so confirm the device
	// is on the bus. Read sysfs instead of `lpinfo`, which cannot see a device the
	// usb backend is already holding for a running job. The DB address may lack the
	// serial, so prefer the queue's device URI from CUPS.
	addr := p.Address
	if out, err := exec.Command("lpstat", "-v", queue).Output(); err == nil {
		if _, uri, ok := strings.Cut(strings.TrimSpace(string(out)), ": "); ok {
			addr = uri
		}
	}
	if serial := usbSerial(addr); serial != "" && !usbSerialPresent(serial) {
		return "Printer USB tidak terdeteksi. Pastikan printer menyala dan kabel USB tersambung."
	}
	return ""
}

// usbSerial extracts serial=... from a CUPS usb:// device URI ("" if absent).
func usbSerial(addr string) string {
	if !strings.HasPrefix(addr, "usb://") {
		return ""
	}
	if _, q, ok := strings.Cut(addr, "?"); ok {
		if v, err := url.ParseQuery(q); err == nil {
			return v.Get("serial")
		}
	}
	return ""
}

func usbSerialPresent(serial string) bool {
	files, _ := filepath.Glob("/sys/bus/usb/devices/*/serial")
	if len(files) == 0 {
		return true // no sysfs (non-Linux): don't block
	}
	for _, f := range files {
		if b, err := os.ReadFile(f); err == nil && strings.TrimSpace(string(b)) == serial {
			return true
		}
	}
	return false
}
