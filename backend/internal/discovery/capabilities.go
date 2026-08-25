package discovery

import (
	"bytes"
	"encoding/binary"
	"encoding/xml"
	"fmt"
	"net"
	"strings"
	"time"
)

// Capabilities mirrors store.Capabilities (kept here to avoid import cycles).
type Capabilities struct {
	PaperSizes   []string `json:"paperSizes"`
	Qualities    []string `json:"qualities"`
	Scalings     []string `json:"scalings"`
	Orientations []string `json:"orientations"`
	Duplex       bool     `json:"duplex"`
	Color        bool     `json:"color"`
	MaxCopies    int      `json:"maxCopies"`
}

// Device is a printer found on the network.
type Device struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Brand      string       `json:"brand"`
	Model      string       `json:"model"`
	Connection string       `json:"connection"`
	Address    string       `json:"address"`
	MAC        string       `json:"mac"`
	IP         string       `json:"ip"`
	Caps       Capabilities `json:"caps"`
	IsVirtual  bool         `json:"isVirtual"` // true = software printer (PDF/OneNote/etc)
	Source     string       `json:"source"`    // windows | cups | ipp
}

// ── Mock profile for simulated printers ──

type mockProfile struct {
	Brand  string
	Model  string
	Color  bool
	Duplex bool
	Speed  string
	Sizes  []string
	Quals  []string
}

var mockPrinters = []mockProfile{
	{Brand: "HP", Model: "DeskJet 4152e", Color: true, Duplex: true, Speed: "8.5 ppm", Sizes: []string{"A4", "A5", "Letter", "Legal", "4x6 Photo"}, Quals: []string{"Draft", "Standard", "High", "Photo"}},
	{Brand: "HP", Model: "LaserJet Pro M404dn", Color: false, Duplex: true, Speed: "40 ppm", Sizes: []string{"A4", "A5", "A3", "Letter", "Legal"}, Quals: []string{"Draft", "Standard", "High"}},
	{Brand: "Epson", Model: "EcoTank L3250", Color: true, Duplex: true, Speed: "10 ppm", Sizes: []string{"A4", "A5", "A6", "Letter", "4x6 Photo", "5x7 Photo"}, Quals: []string{"Draft", "Standard", "High", "Photo"}},
	{Brand: "Epson", Model: "XP-4200", Color: true, Duplex: true, Speed: "33 ppm", Sizes: []string{"A4", "A5", "A6", "Letter", "Legal"}, Quals: []string{"Draft", "Standard", "High", "Photo"}},
	{Brand: "Canon", Model: "PIXMA TS3350", Color: true, Duplex: true, Speed: "7.7 ppm", Sizes: []string{"A4", "A5", "B5", "Letter", "4x6 Photo"}, Quals: []string{"Draft", "Standard", "High"}},
	{Brand: "Canon", Model: "PIXMA MG3620", Color: true, Duplex: true, Speed: "9.9 ppm", Sizes: []string{"A4", "A5", "B5", "Letter"}, Quals: []string{"Draft", "Standard", "High", "Photo"}},
	{Brand: "Brother", Model: "HL-L2350DW", Color: false, Duplex: true, Speed: "32 ppm", Sizes: []string{"A4", "A5", "A6", "Letter", "Legal"}, Quals: []string{"Draft", "Standard", "High"}},
	{Brand: "Brother", Model: "MFC-L2710DW", Color: false, Duplex: true, Speed: "30 ppm", Sizes: []string{"A4", "A5", "A6", "Letter", "Legal"}, Quals: []string{"Draft", "Standard", "High"}},
	{Brand: "Samsung", Model: "M2020", Color: false, Duplex: false, Speed: "20 ppm", Sizes: []string{"A4", "A5", "Letter"}, Quals: []string{"Draft", "Standard"}},
	{Brand: "Xerox", Model: "WorkCentre 6515", Color: true, Duplex: true, Speed: "28 ppm", Sizes: []string{"A4", "A3", "A5", "Letter", "Legal"}, Quals: []string{"Draft", "Standard", "High"}},
}

func defaultSizes() []string { return []string{"A4", "A5", "Letter", "Legal"} }
func defaultQuals() []string { return []string{"Draft", "Standard", "High"} }
func defaultScalings() []string {
	return []string{"Fit to page", "Shrink to fit", "Actual size", "Custom"}
}
func defaultOrients() []string { return []string{"Portrait", "Landscape"} }

// mockDevice builds a simulated printer with capabilities.
func mockDevice(brand, model string, i int) Device {
	var prof *mockProfile
	for idx := range mockPrinters {
		if mockPrinters[idx].Brand == brand && mockPrinters[idx].Model == model {
			prof = &mockPrinters[idx]
			break
		}
	}
	prof = profOrDefault(prof, i)

	conn := "Network"
	ip := fmt.Sprintf("192.168.1.%d", 100+i*7%50)
	if i%4 == 3 {
		conn = "WiFi"
	}
	if i%6 == 5 {
		conn = "USB"
		ip = fmt.Sprintf("USB-%03d", i+1)
	}
	name := fmt.Sprintf("%s %s", prof.Brand, prof.Model)
	if i%3 == 2 {
		name = fmt.Sprintf("%s %s #%d", prof.Brand, prof.Model, i+1)
	}
	return Device{
		ID:         fmt.Sprintf("%s-%s-%d", strings.ToLower(prof.Brand), strings.ToLower(strings.ReplaceAll(prof.Model, " ", "-")), i),
		Name:       name,
		Brand:      prof.Brand,
		Model:      prof.Model,
		Connection: conn,
		Address:    ip,
		MAC:        fmt.Sprintf("3C:52:82:%02X:%02X:%02X", i*11%256, i*37%256, i*91%256),
		IP:         ip,
		Caps: Capabilities{
			PaperSizes:   prof.Sizes,
			Qualities:    prof.Quals,
			Scalings:     defaultScalings(),
			Orientations: defaultOrients(),
			Duplex:       prof.Duplex,
			Color:        prof.Color,
			MaxCopies:    999,
		},
	}
}

func profOrDefault(p *mockProfile, i int) *mockProfile {
	if p != nil {
		return p
	}
	return &mockPrinters[i%len(mockPrinters)]
}

// ── IPP capability detection (real printers) ──

// ippRequest builds a minimal IPP Get-Printer-Attributes POST body.
func ippRequest() []byte {
	var b bytes.Buffer
	// version 1.1
	b.Write([]byte{0x01, 0x01})
	// operation id 0x000B
	binary.Write(&b, binary.BigEndian, uint16(0x000B))
	// request id
	binary.Write(&b, binary.BigEndian, uint32(1))
	// operation attributes tag 0x01
	b.Write([]byte{0x01})
	writeIppAttr(&b, 0x47, "attributes-charset", "utf-8")
	writeIppAttr(&b, 0x48, "attributes-natural-language", "en")
	writeIppAttr(&b, 0x45, "printer-uri", "ipp://localhost/")
	// end tag
	b.Write([]byte{0x03})
	return b.Bytes()
}

// ippResponse is a minimal parser for the attributes we need.
type ippResponse struct {
	Status     uint16
	Attributes map[string][]string
}

func parseIPP(resp []byte) (*ippResponse, error) {
	if len(resp) < 8 {
		return nil, fmt.Errorf("short IPP response")
	}
	out := &ippResponse{
		Status:     binary.BigEndian.Uint16(resp[2:4]),
		Attributes: map[string][]string{},
	}
	// skip version(2) + status(2) + request-id(4)
	body := resp[8:]
	for len(body) > 0 {
		tag := body[0]
		body = body[1:]
		if tag >= 0x00 && tag <= 0x0A {
			// Zero-width unsupported marker + delimiter groups carry no attribute.
			continue
		}
		if len(body) < 2 {
			return out, nil
		}
		nameLen := int(binary.BigEndian.Uint16(body[0:2]))
		if nameLen > len(body)-2 {
			return out, nil
		}
		name := string(body[2 : 2+nameLen])
		body = body[2+nameLen:]
		if len(body) < 2 {
			return out, nil
		}
		valLen := int(binary.BigEndian.Uint16(body[0:2]))
		if valLen > len(body)-2 {
			return out, nil
		}
		val := body[2 : 2+valLen]
		body = body[2+valLen:]

		switch {
		case name == "":
			// RFC 8011: an empty name marks an additional value
			// for the attribute declared immediately before it.
			continue
		case tag == 0x22: // boolean
			s := "false"
			if len(val) == 1 && val[0] == 1 {
				s = "true"
			}
			out.Attributes[name] = append(out.Attributes[name], s)
		case tag == 0x21, tag == 0x23, tag >= 0x40 && tag <= 0x7F:
			// integers/enums kept as raw big-endian bytes; keywords/names/text as strings
			out.Attributes[name] = append(out.Attributes[name], string(val))
		default:
			// ranges, resolutions, collections — skip values
		}
	}
	return out, nil
}

// probeIPP attempts a real IPP query against host:631.
func probeIPP(host string, timeout time.Duration) (*Capabilities, error) {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, "631"), timeout)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	req := ippRequest()
	if _, err := conn.Write(req); err != nil {
		return nil, err
	}
	buf := make([]byte, 65535)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, err
	}
	resp, err := parseIPP(buf[:n])
	if err != nil {
		return nil, err
	}
	return ippToCaps(resp), nil
}

func ippToCaps(r *ippResponse) *Capabilities {
	media := r.Attributes["media-supported"]
	qual := r.Attributes["print-quality-supported"]
	orient := r.Attributes["sides-supported"]
	dup := false
	for _, s := range orient {
		if strings.HasPrefix(s, "two-sided") {
			dup = true
		}
	}
	color := false
	for _, c := range r.Attributes["color-supported"] {
		if c == "true" {
			color = true
		}
	}
	sizes := cleanMedia(media)
	if len(sizes) == 0 {
		sizes = defaultSizes()
	}
	quals := mapQuality(qual)
	return &Capabilities{
		PaperSizes:   sizes,
		Qualities:    quals,
		Scalings:     defaultScalings(),
		Orientations: defaultOrients(),
		Duplex:       dup,
		Color:        color,
		MaxCopies:    999,
	}
}

// cleanMedia normalizes IPP media names (iso_a4_210x297mm → A4).
func cleanMedia(media []string) []string {
	m := map[string]string{
		"iso_a4_210x297mm":         "A4",
		"iso_a5_148x210mm":         "A5",
		"iso_a6_105x148mm":         "A6",
		"iso_a3_297x420mm":         "A3",
		"na_letter_8.5x11in":       "Letter",
		"na_legal_8.5x14in":        "Legal",
		"na_executive_7.25x10.5in": "Executive",
		"na_ledger_11x17in":        "Tabloid",
		"na_index-4x6_4x6in":       "4x6 Photo",
		"na_index-5x7_5x7in":       "5x7 Photo",
	}
	var out []string
	seen := map[string]bool{}
	for _, mname := range media {
		label := m[strings.ToLower(strings.TrimSpace(mname))]
		if label == "" {
			label = mname
		}
		label = strings.ToUpper(label[:1]) + label[1:]
		if !seen[label] {
			seen[label] = true
			out = append(out, label)
		}
	}
	return out
}

func mapQuality(q []string) []string {
	out := []string{"Standard"}
	if len(q) == 0 {
		return out
	}
	for _, s := range q {
		switch s {
		case "3":
			out = appendUnique(out, "Draft")
		case "4":
			out = appendUnique(out, "Standard")
		case "5":
			out = appendUnique(out, "High")
		}
	}
	return out
}

func appendUnique(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

// ── XML helpers (kept for future use: CUPS get-printers) ──

type ippAttrGroup struct {
	XMLName xml.Name `xml:"attrGroup"`
	Attrs   []struct {
		XMLName xml.Name `xml:"attribute"`
		Value   string   `xml:"value"`
	} `xml:"attribute"`
}
