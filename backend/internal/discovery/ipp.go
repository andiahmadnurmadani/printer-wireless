package discovery

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// PrinterInfo is a printer registered on a CUPS/IPP server.
type PrinterInfo struct {
	Name string
	URI  string
}

// JobOptions maps print options to IPP job attributes.
type JobOptions struct {
	Media        string // A4, Letter, ...
	Orientation  string // Portrait | Landscape | reverse-landscape | reverse-portrait
	Sides        string // one-sided | two-sided-long-edge
	Copies       int
	ColorMode    string // color | monochrome
	Quality      string // draft | normal | high
	Scaling      string // "Fit to page" | "Actual size" | "Fill page" | "Shrink to fit"
	JobName      string
	FileType     string // application/pdf, image/png, text/plain, ...
	PageRange    string // e.g. "1", "1-5", "1,3,5-7", "odd", "even" (empty = all)
	PageCount    int    // total pages, needed to expand odd/even selections
	NUp          int    // 1, 2, 4, 6, 9, 16
	Collate      bool   // collated vs uncollated
	MediaType    string // Plain, Photo, Glossy, Matte, Envelope...
	InputTray    string // Main, Rear, Manual, Auto...
	Borderless       bool    // true = full bleed photo
	Booklet          bool    // true = saddle-stitch booklet imposition
	Watermark        string  // custom watermark text
	WatermarkLayout  string  // custom watermark layout position ("center", "diagonal", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right", "tiled")
	WatermarkOpacity float64 // watermark opacity (e.g. 0.15, 0.30, 0.50)
	ManualDuplex     bool    // true = manual odd/even duplex flow
	DuplexStep   string // "odd" | "even"
	// PrintAsImage rasterizes the document before submission (the "print as
	// image" escape hatch every normal print dialog offers).
	PrintAsImage bool
	// PPDSettings carries printer-specific PPD options (Brightness, Contrast,
	// Saturation, ...) straight from the printer's own PPD choices.
	PPDSettings map[string]string
}

// NormalizeHost strips scheme/path from a CUPS URL -> "host:port".
func NormalizeHost(cupsURL string) string {
	cupsURL = strings.TrimSpace(cupsURL)
	cupsURL = strings.TrimPrefix(cupsURL, "http://")
	cupsURL = strings.TrimPrefix(cupsURL, "https://")
	cupsURL = strings.TrimPrefix(cupsURL, "ipp://")
	cupsURL = strings.TrimPrefix(cupsURL, "ipps://")
	cupsURL = strings.TrimSuffix(cupsURL, "/")
	cupsURL = strings.TrimSuffix(cupsURL, "/printers")
	if cupsURL == "" {
		return ""
	}
	if !strings.Contains(cupsURL, ":") {
		cupsURL += ":631"
	}
	return cupsURL
}

// ippHTTP performs an IPP operation over HTTP POST (the way CUPS expects it).
// Returns parsed response attributes.
func ippHTTP(host, path, uri string, operation uint16, jobAttrs map[string]string, copies int, jobName string, docData []byte) (*ippResponse, error) {
	body := ippBuild(operation, uri, jobAttrs, copies, jobName)
	if len(docData) > 0 {
		body = append(body, docData...)
	}
	return ippPostBytes(host, path, body, 15*time.Second)
}

// ippPostBytes POSTs a prebuilt IPP request body and returns the parsed response.
func ippPostBytes(host, path string, body []byte, timeout time.Duration) (*ippResponse, error) {
	target := "http://" + host + path
	req, err := http.NewRequest("POST", target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/ipp")
	req.Header.Set("Accept", "application/ipp")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("CUPS HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data[:min(len(data), 200)])))
	}
	return parseIPP(data)
}

// ippGetPrinters enumerates printers registered on a CUPS/IPP server.
// host is "host:port" (no scheme). Uses CUPS-Get-Printers (0x4001).
func ippGetPrinters(host string, timeout time.Duration) ([]PrinterInfo, error) {
	uri := "ipp://" + host + "/printers/"
	attrs := map[string]string{
		"requested-attributes": "printer-name,printer-uri-supported,printer-state,printer-info,printer-location,printer-make-and-model",
	}
	// requested-attributes is a multi-value keyword; ippBuild writes single value.
	// CUPS is lenient with a single comma-joined string, but to be safe use
	// the simplest form and let CUPS return everything.
	resp, err := ippHTTP(host, "/printers/", uri, 0x4001, attrs, 0, "", nil)
	if err != nil {
		return nil, err
	}

	names := resp.Attributes["printer-name"]
	uris := resp.Attributes["printer-uri-supported"]
	if len(uris) == 0 {
		uris = resp.Attributes["printer-uri"]
	}
	var out []PrinterInfo
	for i, name := range names {
		if name == "" {
			continue
		}
		u := ""
		if i < len(uris) {
			u = uris[i]
		}
		if u == "" {
			u = "ipp://" + host + "/printers/" + url.PathEscape(name)
		}
		out = append(out, PrinterInfo{Name: name, URI: u})
	}
	if len(out) == 0 {
		for _, u := range uris {
			if i := strings.LastIndex(u, "/"); i >= 0 {
				name, _ := url.PathUnescape(u[i+1:])
				if name != "" {
					out = append(out, PrinterInfo{Name: name, URI: u})
				}
			}
		}
	}
	return out, nil
}

// probeIPPPrinter queries Get-Printer-Attributes for a specific printer.
func probeIPPPrinter(host, printerName string, timeout time.Duration) (*Capabilities, error) {
	uri := "ipp://" + host + "/printers/" + url.PathEscape(printerName)
	resp, err := ippHTTP(host, "/printers/"+url.PathEscape(printerName), uri, 0x000B, nil, 0, "", nil)
	if err != nil {
		return nil, err
	}
	return ippToCaps(resp), nil
}

// IppGetPrintersTest exports ippGetPrinters for cmd/ipptest.
func IppGetPrintersTest(host string, timeout time.Duration) ([]PrinterInfo, error) {
	return ippGetPrinters(host, timeout)
}

// ProbeIPPPrinterTest exports probeIPPPrinter for cmd/ipptest.
func ProbeIPPPrinterTest(host, printerName string, timeout time.Duration) (*Capabilities, error) {
	return probeIPPPrinter(host, printerName, timeout)
}

// ProbeIPPPrinterLocalHostTest probes using ipp://localhost/... URI while
// connecting to the given host (bypasses CUPS hostname validation).
func ProbeIPPPrinterLocalHostTest(connHost, printerName string, timeout time.Duration) (*Capabilities, error) {
	uri := "ipp://localhost/printers/" + url.PathEscape(printerName)
	resp, err := ippHTTP(connHost, "/printers/"+url.PathEscape(printerName), uri, 0x000B, nil, 0, "", nil)
	if err != nil {
		return nil, err
	}
	return ippToCaps(resp), nil
}

// SubmitPrintJob sends a real print job to a CUPS/IPP printer via native IPP
// Print-Job (0x0002) over HTTP POST. Returns the authoritative CUPS job id.
func SubmitPrintJob(host, printerName, filePath string, opts JobOptions) (int, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return 0, fmt.Errorf("read file: %w", err)
	}
	if len(data) == 0 {
		return 0, fmt.Errorf("empty document")
	}

	uri := "ipp://" + host + "/printers/" + url.PathEscape(printerName)
	jobName := opts.JobName
	if jobName == "" {
		jobName = filepath.Base(filePath)
	}

	docFormat := opts.FileType
	if docFormat == "" {
		if strings.EqualFold(filepath.Ext(filePath), ".pdf") {
			docFormat = "application/pdf"
		} else {
			docFormat = "application/octet-stream"
		}
	}

	attrs := buildJobAttrs(opts)

	body := ippBuildPrintJob(uri, docFormat, jobName, attrs, opts.Copies)
	body = append(body, data...)

	resp, err := ippPostBytes(host, "/printers/"+url.PathEscape(printerName), body, 30*time.Second)
	if err != nil {
		return 0, err
	}
	if resp.Status >= 0x0400 {
		return 0, fmt.Errorf("CUPS IPP error 0x%04X", resp.Status)
	}

	jobID := 0
	if ids := resp.Attributes["job-id"]; len(ids) > 0 {
		if len(ids[0]) == 4 {
			jobID = int(binary.BigEndian.Uint32([]byte(ids[0])))
		} else {
			fmt.Sscanf(ids[0], "%d", &jobID)
		}
	}
	return jobID, nil
}

// ── IPP binary helpers ──

// buildJobAttrs turns panel options into typed IPP job attributes.
//
// Everything the panel offers is mapped here so the IPP path and the lp path
// apply the same settings. The finishing options (number-up, page range,
// collate, tray, booklet, manual duplex) used to exist only on the lp/SSH path,
// which is why picking them in the panel changed nothing on the live IPP
// deployment.
func buildJobAttrs(opts JobOptions) []jobAttr {
	attrs := []jobAttr{}

	// ── Paper ──────────────────────────────────────────────────────────────
	// Send the PPD PageSize (authoritative for the Epson filter chain) plus the
	// canonical IPP media keyword when CUPS has one. Sending only a long IPP
	// name used to leave exotic sizes unmapped, so the PPD fell back to its
	// default paper and the physical sheet never matched the panel preview.
	isFillScaling := IsFillScaling(opts.Scaling, opts.Borderless)

	if opts.Media != "" {
		ppd := PPDNameForUI(opts.Media)
		if isFillScaling {
			if bPPD := BorderlessPPDName(opts.Media); bPPD != "" {
				ppd = bPPD
			}
		}
		if ppd != "" {
			attrs = append(attrs, jobKeyword("PageSize", ppd))
		}
		if !isFillScaling {
			if ipp := IPPMediaForUI(opts.Media); ipp != "" {
				attrs = append(attrs, jobKeyword("media", ipp))
			}
		}
	}
	if opts.Sides != "" {
		attrs = append(attrs, jobKeyword("sides", opts.Sides))
	}

	// ── Colour ─────────────────────────────────────────────────────────────
	// IMPORTANT: for Epson ESC/P-R (L3210/L3250) only the PPD-native "Ink"
	// option is safe. Sending print-color-mode forces the CUPS raster into a
	// 1-channel colour space that the Epson filter cannot decode — the filter
	// then segfaults, CUPS logs "Sent 0 bytes" and the job still shows as
	// "completed" (silent no-print). Same rule as the lp path in ssh.go.
	if opts.ColorMode == "grayscale" || opts.ColorMode == "monochrome" {
		attrs = append(attrs, jobKeyword("Ink", "MONO"))
	} else {
		attrs = append(attrs, jobKeyword("Ink", "COLOR"))
	}
	if opts.Quality != "" {
		attrs = append(attrs, jobInt("print-quality", qualityToIPPInt(opts.Quality)))
	}

	// ── Scaling ────────────────────────────────────────────────────────────
	if opts.Scaling != "" {
		switch strings.ToLower(opts.Scaling) {
		case "fit to page", "fit":
			attrs = append(attrs, jobKeyword("print-scaling", "fit"), jobBool("fitplot", true))
		case "fill", "fill page", "fill (crop)", "cover", "crop":
			attrs = append(attrs, jobKeyword("print-scaling", "fill"))
		case "shrink to fit":
			attrs = append(attrs, jobKeyword("print-scaling", "auto-fit"))
		case "actual size":
			attrs = append(attrs, jobKeyword("print-scaling", "none"))
		default:
			attrs = append(attrs, jobKeyword("print-scaling", "auto"))
		}
	} else {
		attrs = append(attrs, jobKeyword("print-scaling", "fit"), jobBool("fitplot", true))
	}

	// MediaType must be a PPD keyword (PLAIN_NORMAL, PMPHOTO_HIGH, ...).
	// Passing the UI label ("Plain Paper (Standard)") breaks the Epson filter
	// lookup and crashes it, so unknown labels are dropped entirely.
	if mt := NormalizeMediaTypePPD(opts.MediaType); mt != "" {
		attrs = append(attrs, jobKeyword("MediaType", mt))
	}
	if opts.Orientation != "" {
		attrs = append(attrs, jobInt("orientation-requested", orientationRequested(opts.Orientation)))
	}

	// ── Imposition, page selection & finishing ─────────────────────────────
	if opts.NUp > 1 {
		attrs = append(attrs, jobInt("number-up", int32(opts.NUp)), jobKeyword("number-up-layout", "lrtb"))
	}
	if opts.Collate {
		attrs = append(attrs,
			jobKeyword("multiple-document-handling", "separate-documents-collated-copies"),
			jobKeyword("Collate", "True"))
	} else if opts.Copies > 1 {
		attrs = append(attrs,
			jobKeyword("multiple-document-handling", "separate-documents-uncollated-copies"),
			jobKeyword("Collate", "False"))
	}
	if opts.Booklet {
		attrs = append(attrs, jobKeyword("booklet", "true"), jobKeyword("Booklet", "True"))
	}
	if slot := NormalizeInputSlotPPD(opts.InputTray); slot != "" {
		attrs = append(attrs, jobKeyword("InputSlot", slot))
	} else if slot := NormalizeInputSlotPPD(opts.PPDSettings["InputSlot"]); slot != "" {
		attrs = append(attrs, jobKeyword("InputSlot", slot))
	}
	// Printer-specific PPD options (Brightness, Contrast, Saturation, ...). Only
	// bare keywords are forwarded: these values come from the printer's own PPD
	// choice list, and a display label here would break the filter chain exactly
	// like the MediaType label did.
	for _, kv := range PPDSettingsArgs(opts.PPDSettings) {
		attrs = append(attrs, jobKeyword(kv[0], kv[1]))
	}
	if opts.ManualDuplex {
		// page-set is the CUPS option the page filter understands for the
		// odd/even passes; it is what the lp path has always used.
		switch strings.ToLower(opts.DuplexStep) {
		case "odd":
			attrs = append(attrs, jobKeyword("page-set", "odd"))
		case "even":
			attrs = append(attrs, jobKeyword("page-set", "even"))
		}
	} else {
		for _, r := range parsePageRanges(opts.PageRange, opts.PageCount) {
			attrs = append(attrs, jobRange("page-ranges", r[0], r[1]))
		}
	}

	return attrs
}

// ── Job attribute encoding ───────────────────────────────────────────────────
//
// Job options are encoded with explicit IPP value tags. This matters: a
// "number-up" or "collate" sent as a keyword is silently ignored by CUPS, which
// is exactly how N-Up / collate ended up doing nothing on the IPP path.

// jobAttr is one IPP job attribute with its IPP syntax tag.
type jobAttr struct {
	tag  byte   // 0x21 integer, 0x22 boolean, 0x33 rangeOfInteger, 0x44 keyword
	name string
	str  string
	num  int32
	rng  [2]int32
}

// jobKeyword builds a keyword (0x44) attribute.
func jobKeyword(name, value string) jobAttr {
	return jobAttr{tag: 0x44, name: name, str: value}
}

// jobInt builds an integer (0x21) attribute.
func jobInt(name string, v int32) jobAttr {
	return jobAttr{tag: 0x21, name: name, num: v}
}

// jobBool builds a boolean (0x22) attribute.
func jobBool(name string, v bool) jobAttr {
	n := int32(0)
	if v {
		n = 1
	}
	return jobAttr{tag: 0x22, name: name, num: n}
}

// jobRange builds a rangeOfInteger (0x33) attribute.
func jobRange(name string, from, to int32) jobAttr {
	return jobAttr{tag: 0x33, name: name, rng: [2]int32{from, to}}
}

// orientationRequested maps an orientation name to the IPP enum (3 = portrait,
// 4 = landscape, 5 = reverse landscape, 6 = reverse portrait).
func orientationRequested(o string) int32 {
	switch strings.ToLower(strings.TrimSpace(o)) {
	case "landscape":
		return 4
	case "reverse-landscape":
		return 5
	case "reverse-portrait":
		return 6
	default:
		return 3
	}
}

// qualityToIPPInt maps a panel quality label to the IPP print-quality enum.
func qualityToIPPInt(q string) int32 {
	switch strings.ToLower(strings.TrimSpace(q)) {
	case "draft":
		return 3
	case "high", "photo":
		return 5
	default:
		return 4
	}
}

// parsePageRanges turns the panel's page selection into IPP page-ranges.
// Accepts "1-3,5", "odd", "even" and "" (= all pages). odd/even need the page
// count, which the panel already knows and sends as pages.
func parsePageRanges(sel string, pageCount int) [][2]int32 {
	sel = NormalizePageRange(sel)
	if sel == "" {
		return nil
	}
	low := strings.ToLower(sel)
	if low == "odd" || low == "even" {
		if pageCount <= 0 {
			return nil
		}
		start := int32(1)
		if low == "even" {
			start = 2
		}
		var out [][2]int32
		for p := start; p <= int32(pageCount); p += 2 {
			out = append(out, [2]int32{p, p})
		}
		return out
	}
	var out [][2]int32
	for _, part := range strings.Split(sel, ",") {
		if part == "" {
			continue
		}
		if i := strings.Index(part, "-"); i > 0 {
			from, errA := strconv.Atoi(part[:i])
			to, errB := strconv.Atoi(part[i+1:])
			if errA == nil && errB == nil && from > 0 && to >= from {
				out = append(out, [2]int32{int32(from), int32(to)})
			}
			continue
		}
		if n, err := strconv.Atoi(part); err == nil && n > 0 {
			out = append(out, [2]int32{int32(n), int32(n)})
		}
	}
	return out
}

// NormalizeInputSlotPPD returns a PPD-native InputSlot keyword, or "" when the
// value is not one. The panel ships a hardcoded tray list ("Main Cassette /
// Tray 1") which is a human label — passing it through makes the Epson filter
// fail the same way a MediaType label did (job 193, 2026-09-24).
func NormalizeInputSlotPPD(v string) string {
	s := strings.TrimSpace(v)
	if s == "" {
		return ""
	}
	switch strings.ToLower(s) {
	case "auto select", "auto", "default", "auto-select":
		return ""
	}
	// PPD option values are bare keywords; anything with spaces, slashes or
	// parentheses is a display label and must never reach the filter chain.
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-', r == '.':
		default:
			return ""
		}
	}
	return s
}

// reservedJobOption lists attributes KroomPrint sets itself; the PPD passthrough
// must never override them (a stray PageSize/Ink from the client could undo the
// Epson-safe option mapping).
func reservedJobOption(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "pagesize", "mediatype", "ink", "inputslot", "media", "sides", "collate",
		"booklet", "print-quality", "orientation-requested", "print-scaling",
		"fitplot", "number-up", "number-up-layout", "page-set", "copies",
		"multiple-document-handling", "page-ranges", "job-name",
		"requesting-user-name", "document-format", "printer-uri":
		return true
	}
	return false
}

// sortedPDDOptionNames returns the PPD option names in a stable order so the
// encoded request does not shuffle between identical jobs.
func sortedPDDOptionNames(settings map[string]string) []string {
	if len(settings) == 0 {
		return nil
	}
	names := make([]string, 0, len(settings))
	for k := range settings {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

// PPDSettingsArgs returns the printer-specific PPD options as ordered
// (name, value) pairs, skipping the attributes KroomPrint controls itself and
// anything that is not a bare PPD keyword. Shared by the IPP and lp paths so
// both apply the same operator choices.
func PPDSettingsArgs(settings map[string]string) [][2]string {
	var out [][2]string
	for _, name := range sortedPDDOptionNames(settings) {
		if reservedJobOption(name) {
			continue
		}
		if NormalizeInputSlotPPD(name) == "" {
			continue // the option name itself is not a bare PPD keyword
		}
		if v := NormalizeInputSlotPPD(settings[name]); v != "" {
			out = append(out, [2]string{strings.TrimSpace(name), v})
		}
	}
	return out
}

func ippBuildPrintJob(uri, docFormat, jobName string, attrs []jobAttr, copies int) []byte {
	var b bytes.Buffer
	b.Write([]byte{0x01, 0x01}) // IPP/1.1
	binary.Write(&b, binary.BigEndian, uint16(0x0002)) // Print-Job
	binary.Write(&b, binary.BigEndian, uint32(1))      // request-id

	// Operation attributes group (tag 0x01)
	b.WriteByte(0x01)
	writeIppAttr(&b, 0x47, "attributes-charset", "utf-8")
	writeIppAttr(&b, 0x48, "attributes-natural-language", "en")
	writeIppAttr(&b, 0x45, "printer-uri", uri)
	if jobName != "" {
		writeIppAttr(&b, 0x42, "job-name", jobName)
	}
	writeIppAttr(&b, 0x42, "requesting-user-name", "kroomprint")
	if docFormat != "" {
		writeIppAttr(&b, 0x49, "document-format", docFormat)
	}

	// Job attributes group (tag 0x02)
	if len(attrs) > 0 || copies > 0 {
		b.WriteByte(0x02)
		for _, a := range attrs {
			writeJobAttr(&b, a)
		}
		if copies > 0 {
			writeIppInt(&b, 0x21, "copies", int32(copies))
		}
	}
	b.WriteByte(0x03) // end-of-attributes
	return b.Bytes()
}

func writeJobAttr(b *bytes.Buffer, a jobAttr) {
	switch a.tag {
	case 0x21, 0x22:
		writeIppInt(b, a.tag, a.name, a.num)
	case 0x33:
		b.WriteByte(a.tag)
		writeIppUint16(b, uint16(len(a.name)))
		b.WriteString(a.name)
		writeIppUint16(b, 8) // two int32 values
		binary.Write(b, binary.BigEndian, a.rng[0])
		binary.Write(b, binary.BigEndian, a.rng[1])
	default:
		writeIppAttr(b, a.tag, a.name, a.str)
	}
}

// ippBuild builds a minimal generic IPP request.
func ippBuild(operation uint16, uri string, jobAttrs map[string]string, copies int, jobName string) []byte {
	var b bytes.Buffer
	b.Write([]byte{0x01, 0x01}) // IPP/1.1
	binary.Write(&b, binary.BigEndian, operation)
	binary.Write(&b, binary.BigEndian, uint32(1)) // request-id

	// Operation attributes group
	b.WriteByte(0x01)
	writeIppAttr(&b, 0x47, "attributes-charset", "utf-8")
	writeIppAttr(&b, 0x48, "attributes-natural-language", "en")
	writeIppAttr(&b, 0x45, "printer-uri", uri)
	if jobName != "" {
		writeIppAttr(&b, 0x42, "job-name", jobName)
	}
	writeIppAttr(&b, 0x42, "requesting-user-name", "kroomprint")

	// Job attributes group
	if len(jobAttrs) > 0 || copies > 0 {
		b.WriteByte(0x02)
		for k, v := range jobAttrs {
			writeIppAttr(&b, 0x44, k, v)
		}
		if copies > 0 {
			writeIppInt(&b, 0x21, "copies", int32(copies))
		}
	}
	b.WriteByte(0x03) // end-of-attributes
	return b.Bytes()
}

func writeIppAttr(b *bytes.Buffer, tag byte, name, value string) {
	b.WriteByte(tag)
	writeIppUint16(b, uint16(len(name)))
	b.WriteString(name)
	writeIppUint16(b, uint16(len(value)))
	b.WriteString(value)
}

func writeIppInt(b *bytes.Buffer, tag byte, name string, value int32) {
	b.WriteByte(tag)
	writeIppUint16(b, uint16(len(name)))
	b.WriteString(name)
	writeIppUint16(b, 4)
	binary.Write(b, binary.BigEndian, value)
}

func writeIppUint16(b *bytes.Buffer, v uint16) {
	binary.Write(b, binary.BigEndian, v)
}

// parseIPP parses an IPP response into status + attributes.
// (Defined in capabilities.go — shared.)

func qualityToIPP(q string) string {
	switch strings.ToLower(q) {
	case "draft":
		return "3"
	case "high", "photo":
		return "5"
	default:
		return "4"
	}
}
