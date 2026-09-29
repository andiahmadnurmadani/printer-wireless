package discovery

import (
	"context"
	"crypto/md5"
	"fmt"
	"log"
	"net"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"sync"
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
// mDNS / AirPrint / IPP Everywhere services, dynamic subnet sweeps, and remote CUPS.
func (s *Scanner) Scan() ([]Device, error) {
	if s.Delay > 0 {
		time.Sleep(s.Delay)
	}
	var out []Device
	seen := map[string]bool{}
	var mu sync.Mutex

	add := func(d Device) {
		if d.ID == "" {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if seen[d.ID] || seen[d.Address] {
			return
		}
		seen[d.ID] = true
		seen[d.Address] = true
		out = append(out, d)
	}

	var wg sync.WaitGroup

	// 1. USB printers physically connected to this host.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for _, d := range s.scanUSB() {
			add(d)
		}
	}()

	// 2. mDNS / Bonjour / AirPrint discovery via ippfind & driverless.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for _, d := range s.scanMdns() {
			add(d)
		}
	}()

	// 3. Dynamic subnet IP scan for open printer ports (631, 9100, 515).
	wg.Add(1)
	go func() {
		defer wg.Done()
		for _, d := range s.scanSubnets() {
			add(d)
		}
	}()

	// 4. Remote CUPS server (if configured).
	if s.CUPSURL != "" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for _, d := range s.scanRemoteCUPS() {
				add(d)
			}
		}()
	}

	wg.Wait()
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
	case strings.Contains(lower, "deskjet"):
		return "HP", "DeskJet Series"
	case strings.Contains(lower, "hp"):
		return "HP", name
	case strings.Contains(lower, "pixma"):
		return "Canon", "PIXMA Series"
	case strings.Contains(lower, "canon"):
		return "Canon", name
	case strings.Contains(lower, "brother") || strings.Contains(lower, "hl-"):
		return "Brother", name
	default:
		return "Network Printer", name
	}
}

// ── mDNS & AirPrint Discovery (ippfind, driverless) ──

func (s *Scanner) scanMdns() []Device {
	var out []Device

	// Try ippfind (Standard CUPS mDNS discovery)
	if path, err := exec.LookPath("ippfind"); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		cmd := exec.CommandContext(ctx, path, "-T", "2")
		output, _ := cmd.Output()
		cancel()

		for _, line := range strings.Split(string(output), "\n") {
			uri := strings.TrimSpace(line)
			if uri == "" || (!strings.HasPrefix(uri, "ipp://") && !strings.HasPrefix(uri, "ipps://") && !strings.HasPrefix(uri, "http://")) {
				continue
			}

			parsed, pErr := url.Parse(uri)
			if pErr != nil {
				continue
			}

			host := parsed.Hostname()
			brand, model := inferBrandAndModel(parsed.Path + " " + host)
			name := fmt.Sprintf("%s (%s)", model, host)

			caps := usbCaps()
			if c, err := probeIPP(parsed.Host, 1000*time.Millisecond); err == nil {
				caps = c
			}

			h := md5.Sum([]byte(uri))
			out = append(out, Device{
				ID:         fmt.Sprintf("mdns-%x", h[:4]),
				Name:       name,
				Brand:      brand,
				Model:      model,
				Connection: "Network (AirPrint/mDNS)",
				Address:    uri,
				MAC:        "—",
				IP:         host,
				Caps:       *caps,
				Source:     "mdns",
			})
		}
	}

	// Try driverless
	if path, err := exec.LookPath("driverless"); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		cmd := exec.CommandContext(ctx, path)
		output, _ := cmd.Output()
		cancel()

		for _, line := range strings.Split(string(output), "\n") {
			uri := strings.TrimSpace(line)
			if uri == "" || strings.HasPrefix(uri, "DEBUG:") {
				continue
			}

			brand, model := inferBrandAndModel(uri)
			h := md5.Sum([]byte(uri))
			out = append(out, Device{
				ID:         fmt.Sprintf("driverless-%x", h[:4]),
				Name:       model,
				Brand:      brand,
				Model:      model,
				Connection: "Network (IPP Everywhere)",
				Address:    uri,
				MAC:        "—",
				IP:         "",
				Caps:       *usbCaps(),
				Source:     "driverless",
			})
		}
	}

	return out
}

// ── Fast Dynamic Subnet & Port Sweep ──

func (s *Scanner) scanSubnets() []Device {
	var out []Device
	var mu sync.Mutex

	subnets := getLocalSubnets()
	if len(subnets) == 0 {
		subnets = []string{"127.0.0.1", "192.168.1.1", "192.168.0.1"}
	}

	type probeTarget struct {
		ip   string
		port int
	}

	targets := make(chan probeTarget, 3000)

	// High concurrency worker pool
	workerCount := 128
	var wg sync.WaitGroup

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for t := range targets {
				// net.JoinHostPort brackets IPv6 literals correctly; a raw
				// "%s:%d" produces an undialable address for IPv6 targets.
				address := net.JoinHostPort(t.ip, fmt.Sprint(t.port))
				conn, err := net.DialTimeout("tcp", address, 200*time.Millisecond)
				if err != nil {
					continue
				}
				conn.Close()

				var dev Device
				h := md5.Sum([]byte(address))
				hexID := fmt.Sprintf("%x", h[:4])

				if t.port == 631 {
					caps, cErr := probeIPP(t.ip, 800*time.Millisecond)
					if cErr != nil {
						caps = usbCaps()
					}
					brand, model := inferBrandAndModel("Network IPP Printer " + t.ip)
					dev = Device{
						ID:         fmt.Sprintf("ipp-%s-%s", strings.ReplaceAll(t.ip, ".", "-"), hexID),
						Name:       fmt.Sprintf("%s (%s)", model, t.ip),
						Brand:      brand,
						Model:      model,
						Connection: "Network (IPP/631)",
						Address:    fmt.Sprintf("ipp://%s:631/ipp/print", t.ip),
						MAC:        "—",
						IP:         t.ip,
						Caps:       *caps,
						Source:     "ipp",
					}
				} else if t.port == 9100 {
					brand, model := inferBrandAndModel("RAW JetDirect Printer " + t.ip)
					dev = Device{
						ID:         fmt.Sprintf("raw-%s-%s", strings.ReplaceAll(t.ip, ".", "-"), hexID),
						Name:       fmt.Sprintf("%s (%s:9100)", model, t.ip),
						Brand:      brand,
						Model:      model,
						Connection: "Network (RAW/9100)",
						Address:    fmt.Sprintf("socket://%s:9100", t.ip),
						MAC:        "—",
						IP:         t.ip,
						Caps:       *usbCaps(),
						Source:     "socket",
					}
				} else if t.port == 515 {
					brand, model := inferBrandAndModel("LPD Printer " + t.ip)
					dev = Device{
						ID:         fmt.Sprintf("lpd-%s-%s", strings.ReplaceAll(t.ip, ".", "-"), hexID),
						Name:       fmt.Sprintf("%s (%s:515)", model, t.ip),
						Brand:      brand,
						Model:      model,
						Connection: "Network (LPD/515)",
						Address:    fmt.Sprintf("lpd://%s/raw", t.ip),
						MAC:        "—",
						IP:         t.ip,
						Caps:       *usbCaps(),
						Source:     "lpd",
					}
				}

				if dev.ID != "" {
					mu.Lock()
					out = append(out, dev)
					mu.Unlock()
				}
			}
		}()
	}

	// Feed targets asynchronously
	go func() {
		portsToScan := []int{631, 9100, 515}
		for _, ip := range subnets {
			for _, port := range portsToScan {
				targets <- probeTarget{ip: ip, port: port}
			}
		}
		close(targets)
	}()

	wg.Wait()
	return out
}

func getLocalSubnets() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}

	for _, iface := range ifaces {
		// Only check UP and non-loopback interfaces
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		// Skip virtual docker/bridge/vpn interfaces for fast subnet scan
		name := strings.ToLower(iface.Name)
		if strings.HasPrefix(name, "docker") || strings.HasPrefix(name, "br-") || strings.HasPrefix(name, "veth") {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP.To4() == nil {
				continue
			}

			ip4 := ipNet.IP.To4()
			mask := ipNet.Mask

			// Scan private physical LAN subnet (e.g. 192.168.x.x)
			if len(mask) == 4 && mask[0] == 255 && mask[1] == 255 && mask[2] == 255 && ip4[0] == 192 && ip4[1] == 168 {
				base := fmt.Sprintf("%d.%d.%d", ip4[0], ip4[1], ip4[2])
				for host := 1; host <= 254; host++ {
					ips = append(ips, fmt.Sprintf("%s.%d", base, host))
				}
			} else {
				ips = append(ips, ip4.String())
			}
		}
	}

	ips = append(ips, "127.0.0.1")
	return ips
}

// ── Remote CUPS Scanner ──

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

// ── USB Printers Scanner ──

func (s *Scanner) scanUSB() []Device {
	var out []Device
	if runtime.GOOS == "windows" {
		out = append(out, s.scanUSBWindows()...)
	} else {
		out = append(out, s.scanUSBCUPS()...)
	}
	return out
}

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

func (s *Scanner) scanUSBWindows() []Device {
	var out []Device
	ps := `Get-CimInstance Win32_Printer | ForEach-Object { "$($_.Name)` + "`t" + `$($_.PortName)` + "`t" + `$($_.DriverName)` + "`t" + `$($_.PrinterStatus)` + "`t" + `$($_.WorkOffline)" }`
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
		parts := strings.Split(line, "	")
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
		parts := strings.SplitN(line, " ", 2)
		if len(parts) != 2 {
			continue
		}
		uri := strings.TrimSpace(parts[1])

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
