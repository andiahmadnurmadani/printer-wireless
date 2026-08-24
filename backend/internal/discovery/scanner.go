package discovery

import (
	"crypto/md5"
	"fmt"
	"log"
	"net"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// Scanner performs discovery of printers.
type Scanner struct {
	// CUPSURL is a remote CUPS server (e.g. http://100.90.80.85:631
	// or ssh://amba@100.90.80.85). When set, printers registered there
	// are discovered via IPP (http) or SSH commands (ssh).
	CUPSURL string
	// CUPSSSH is the SSH target for ssh:// CUPS URLs (user@host).
	CUPSSSH string
	// Delay simulates scan time.
	Delay time.Duration
	// Log is an optional logger.
	Log *log.Logger
}

// Scan finds real printers: USB devices attached to this machine,
// IPP endpoints on the network, and printers on a configured remote CUPS.
// No simulated devices — only hardware that actually exists.
func (s *Scanner) Scan() ([]Device, error) {
	if s.Delay > 0 {
		time.Sleep(s.Delay)
	}
	var out []Device
	seen := map[string]bool{}
	add := func(d Device) {
		if d.ID == "" || seen[d.ID] {
			return
		}
		seen[d.ID] = true
		out = append(out, d)
	}

	// 1. USB printers physically connected to this host.
	for _, d := range s.scanUSB() {
		add(d)
	}

	// 2. Remote CUPS server (e.g. pc-hitam at 100.90.80.85:631 or ssh://amba).
	if s.CUPSURL != "" {
		for _, d := range s.scanRemoteCUPS() {
			add(d)
		}
	}

	// 3. Real IPP printers (CUPS localhost + LAN).
	for _, d := range s.probeReal() {
		add(d)
	}
	return out, nil
}

func inferBrandAndModel(name string) (brand string, model string) {
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "l3210"):
		return "Epson", "EcoTank L3210"
	case strings.Contains(lower, "l3250"):
		return "Epson", "EcoTank L3250"
	case strings.Contains(lower, "l3150"):
		return "Epson", "EcoTank L3150"
	case strings.Contains(lower, "epson"):
		return "Epson", name
	case strings.Contains(lower, "laserjet") || strings.Contains(lower, "m404"):
		return "HP", "LaserJet Pro"
	case strings.Contains(lower, "hp"):
		return "HP", name
	case strings.Contains(lower, "pixma") || strings.Contains(lower, "canon"):
		return "Canon", name
	case strings.Contains(lower, "brother") || strings.Contains(lower, "hl-"):
		return "Brother", name
	default:
		return "CUPS", name
	}
}

// scanRemoteCUPS enumerates printers on a remote CUPS server.
//   - ssh://user@host → SSH commands (lpstat/lpoptions)
//   - http://host:631 → IPP Get-Printers + Get-Printer-Attributes
func (s *Scanner) scanRemoteCUPS() []Device {
	var out []Device

	if IsSSHURL(s.CUPSURL) {
		userHost := s.CUPSSSH
		if userHost == "" {
			userHost = NormalizeSSHHost(s.CUPSURL)
		}
		printers, err := SSHListPrinters(userHost)
		if err != nil {
			if s.Log != nil {
				s.Log.Printf("ssh cups %s: %v", userHost, err)
			}
			return out
		}
		for _, p := range printers {
			caps, err := SSHProbePrinter(userHost, p.Name)
			if err != nil {
				if s.Log != nil {
					s.Log.Printf("ssh probe %s: %v", p.Name, err)
				}
				caps = usbCaps()
			}
			brand, model := inferBrandAndModel(p.Name)
			displayName := brand + " " + p.Name
			if strings.HasPrefix(strings.ToLower(p.Name), strings.ToLower(brand)) {
				displayName = p.Name
			}
			out = append(out, Device{
				ID:         "cups-" + strings.ToLower(p.Name),
				Name:       displayName,
				Brand:      brand,
				Model:      model,
				Connection: "Network (" + userHost + ")",
				Address:    fmt.Sprintf("ssh://%s/printers/%s", userHost, p.Name),
				MAC:        "—",
				IP:         userHost,
				Caps:       *caps,
				Source:     "cups",
			})
		}
		return out
	}

	host := NormalizeHost(s.CUPSURL)
	if host == "" {
		return out
	}
	printers, err := ippGetPrinters(host, 3*time.Second)
	if err != nil {
		if s.Log != nil {
			s.Log.Printf("remote CUPS %s: %v", host, err)
		}
		return out
	}
	for _, p := range printers {
		caps, err := probeIPPPrinter(host, p.Name, 3*time.Second)
		if err != nil {
			if s.Log != nil {
				s.Log.Printf("probe %s: %v", p.Name, err)
			}
			caps = usbCaps()
		}
		out = append(out, Device{
			ID:         "cups-" + strings.ToLower(p.Name),
			Name:       p.Name,
			Brand:      "CUPS",
			Model:      p.URI,
			Connection: "Network",
			Address:    p.URI,
			MAC:        "—",
			IP:         strings.Split(host, ":")[0],
			Caps:       *caps,
			Source:     "cups",
		})
	}
	return out
}

// scanUSB enumerates printers connected via USB on this machine.
//   - Windows: HKLM\SYSTEM\CurrentControlSet\Enum\USBSTOR (devices the OS sees)
//   - Linux:   `lpinfo -v` from CUPS (prints USB/parallel/driver URIs)
func (s *Scanner) scanUSB() []Device {
	var out []Device

	if runtime.GOOS == "windows" {
		out = append(out, s.scanUSBWindows()...)
	} else {
		out = append(out, s.scanUSBCUPS()...)
	}
	return out
}

// isVirtualPrinter checks whether a printer is software/virtual (PDF, RustDesk, OneNote, Fax, etc.)
func isVirtualPrinter(name, port, driver string) bool {
	lowerName := strings.ToLower(name)
	lowerPort := strings.ToLower(port)
	lowerDriver := strings.ToLower(driver)

	if lowerPort == "portprompt:" || lowerPort == "nul:" || lowerPort == "file:" || strings.Contains(lowerPort, "rustdesk") {
		return true
	}

	virtualKeywords := []string{
		"rustdesk",
		"onenote",
		"print to pdf",
		"pdf writer",
		"pdf creator",
		"pdf24",
		"cute pdf",
		"cutepdf",
		"xps document writer",
		"fax",
		"anydesk",
		"teamviewer",
		"adobe pdf",
		"foxit",
		"send to onenote",
		"root print queue",
		"microsoft xps",
	}

	for _, kw := range virtualKeywords {
		if strings.Contains(lowerName, kw) || strings.Contains(lowerDriver, kw) || strings.Contains(lowerPort, kw) {
			return true
		}
	}
	return false
}

// scanUSBWindows enumerates printers installed on this Windows machine
// via WMI Win32_Printer — covers USB, network, and virtual printers.
// Runs PowerShell once and parses tab-separated output (no JSON overhead).
func (s *Scanner) scanUSBWindows() []Device {
	var out []Device
	ps := `Get-CimInstance Win32_Printer | ForEach-Object { "$($_.Name) " + [char]9 + "$($_.PortName) " + [char]9 + "$($_.DriverName) " + [char]9 + "$($_.PrinterStatus) " + [char]9 + "$($_.WorkOffline)" }`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	output, err := cmd.Output()
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		if name == "" {
			continue
		}
		port := strings.TrimSpace(parts[1])
		driver := ""
		if len(parts) > 2 {
			driver = strings.TrimSpace(parts[2])
		}
		conn := "USB"
		virtual := isVirtualPrinter(name, port, driver)
		if strings.Contains(strings.ToLower(port), "ip_") || strings.HasPrefix(strings.ToLower(port), "wsp://") ||
			strings.HasPrefix(strings.ToLower(port), "http://") || strings.HasPrefix(strings.ToLower(port), "ipp://") {
			conn = "Network"
		} else if virtual {
			conn = "Virtual"
		}

		out = append(out, Device{
			ID:         "win-" + name,
			Name:       name,
			Brand:      "Windows",
			Model:      driver,
			Connection: conn,
			Address:    port,
			MAC:        "—",
			IP:         "",
			Caps:       *usbCaps(),
			IsVirtual:  virtual,
			Source:     "windows",
		})
	}
	return out
}

func (s *Scanner) scanUSBCUPS() []Device {
	var out []Device
	cmd := exec.Command("lpinfo", "-v")
	output, err := cmd.Output()
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: "direct usb://Brother/HL-L2350DW?serial=..."
		parts := strings.SplitN(line, " ", 2)
		if len(parts) != 2 {
			continue
		}
		uri := strings.TrimSpace(parts[1])

		// Filter out generic CUPS backends that are not actual devices
		if !strings.HasPrefix(uri, "usb://") && !strings.HasPrefix(uri, "dnssd://") && !strings.HasPrefix(uri, "socket://") && !strings.HasPrefix(uri, "ipp://") && !strings.HasPrefix(uri, "ipps://") {
			continue
		}

		conn := "USB"
		if strings.HasPrefix(uri, "network") || strings.HasPrefix(uri, "dnssd") || strings.HasPrefix(uri, "ipp") || strings.HasPrefix(uri, "socket") {
			conn = "Network"
		}

		var brand, model, displayName, safeID string
		h := md5.Sum([]byte(uri))
		hexHash := fmt.Sprintf("%x", h[:4])

		if strings.HasPrefix(uri, "usb://") {
			rawPath := strings.TrimPrefix(uri, "usb://")
			subparts := strings.SplitN(rawPath, "/", 2)
			brand = subparts[0]
			model = brand
			if len(subparts) == 2 {
				modelPart := strings.SplitN(subparts[1], "?", 2)[0]
				if unescaped, err := url.PathUnescape(modelPart); err == nil {
					model = unescaped
				} else {
					model = modelPart
				}
			}
			brand = strings.Title(strings.ToLower(brand))
			displayName = brand + " " + model
			slug := strings.ToLower(strings.ReplaceAll(model, " ", "-"))
			slug = strings.ReplaceAll(slug, "%20", "-")
			safeID = fmt.Sprintf("cups-usb-%s-%s", slug, hexHash)
		} else {
			displayName = uri
			brand = "CUPS"
			model = uri
			safeID = fmt.Sprintf("cups-%s", hexHash)
		}

		out = append(out, Device{
			ID:         safeID,
			Name:       displayName,
			Brand:      brand,
			Model:      model,
			Connection: conn,
			Address:    uri,
			MAC:        "—",
			IP:         "",
			Caps:       *usbCaps(),
			Source:     "cups",
		})
	}
	return out
}

// usbCaps returns conservative capabilities for a USB printer found via OS.
// Real IPP probing happens per-device when needed (add flow).
func usbCaps() *Capabilities {
	return &Capabilities{
		PaperSizes:   []string{"A4", "A5", "Letter", "Legal"},
		Qualities:    []string{"Draft", "Standard", "High"},
		Scalings:     defaultScalings(),
		Orientations: defaultOrients(),
		Duplex:       true,
		Color:        true,
		MaxCopies:    999,
	}
}

func (s *Scanner) probeReal() []Device {
	var out []Device
	// CUPS on localhost (Linux/macOS)
	if host := "127.0.0.1"; s.probeHost(host) {
		if d, ok := s.deviceFromProbe(host, "CUPS Printer", "Network"); ok {
			out = append(out, d)
		}
	}
	// A few common LAN hosts (only reachable on real networks)
	for _, ip := range []string{"192.168.1.1", "192.168.0.1"} {
		if !s.probeHost(ip) {
			continue
		}
		if d, ok := s.deviceFromProbe(ip, "Network Printer", "Network"); ok {
			out = append(out, d)
		}
	}
	return out
}

func (s *Scanner) probeHost(host string) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, "631"), 800*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func (s *Scanner) deviceFromProbe(ip, name, conn string) (Device, bool) {
	caps, err := probeIPP(ip, 1500*time.Millisecond)
	if err != nil {
		return Device{}, false
	}
	model := "IPP Printer"
	brand := "Generic"
	if strings.Contains(name, "CUPS") {
		brand = "CUPS"
		model = "Virtual Printer"
	}
	return Device{
		ID:         fmt.Sprintf("ipp-%s", strings.ReplaceAll(ip, ".", "-")),
		Name:       name,
		Brand:      brand,
		Model:      model,
		Connection: conn,
		Address:    ip,
		MAC:        "—",
		IP:         ip,
		Caps:       *caps,
		Source:     "ipp",
	}, true
}
