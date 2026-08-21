package discovery

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
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
	Media     string // A4, Letter, ...
	Sides     string // one-sided | two-sided-long-edge
	Copies    int
	ColorMode string // color | monochrome
	Quality   string // draft | normal | high
	JobName   string
	FileType  string // application/pdf, image/png, text/plain, ...
	PageRange string // e.g. "1", "1-5", "1,3,5-7" (empty = all pages)
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

	url := "http://" + host + path
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/ipp")
	req.Header.Set("Accept", "application/ipp")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))

	client := &http.Client{Timeout: 15 * time.Second}
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

// SubmitPrintJob sends a real print job to a CUPS/IPP printer via IPP
// Print-Job (0x0002) over HTTP POST. Returns the CUPS job id.
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
		jobName = "kroomprint-job"
	}

	attrs := map[string]string{}
	if opts.Media != "" {
		attrs["media"] = normalizeMedia(opts.Media)
	}
	if opts.Sides != "" {
		attrs["sides"] = opts.Sides
	}
	if opts.ColorMode == "grayscale" || opts.ColorMode == "monochrome" {
		attrs["print-color-mode"] = "monochrome"
	} else if opts.ColorMode == "color" {
		attrs["print-color-mode"] = "color"
	}
	if opts.Quality != "" {
		attrs["print-quality"] = qualityToIPP(opts.Quality)
	}

	resp, err := ippHTTP(host, "/printers/"+url.PathEscape(printerName), uri, 0x0002, attrs, opts.Copies, jobName, data)
	if err != nil {
		return 0, err
	}
	jobID := 0
	if ids := resp.Attributes["job-id"]; len(ids) > 0 {
		fmt.Sscanf(ids[0], "%d", &jobID)
	}
	return jobID, nil
}

// BuildIPPDebug exports ippBuild for cmd/ipptest.
func BuildIPPDebug(operation uint16, uri string, jobAttrs map[string]string, copies int, jobName string) []byte {
	return ippBuild(operation, uri, jobAttrs, copies, jobName)
}

// ── IPP binary helpers ──

// ippBuild builds a minimal IPP request: header + operation attrs + job attrs.
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
			// keywords and name values use tag 0x44 (keyword) — but media,
			// sides, print-quality, print-color-mode are keyword values.
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
	b.WriteByte(byte(len(name)))
	b.WriteString(name)
	binary.Write(b, binary.BigEndian, uint32(len(value)))
	b.WriteString(value)
}

func writeIppInt(b *bytes.Buffer, tag byte, name string, value int32) {
	b.WriteByte(tag)
	b.WriteByte(byte(len(name)))
	b.WriteString(name)
	binary.Write(b, binary.BigEndian, uint32(4))
	binary.Write(b, binary.BigEndian, value)
}

// parseIPP parses an IPP response into status + attributes.
// (Defined in capabilities.go — shared.)

// normalizeMedia maps common UI labels to IPP media keywords.
func normalizeMedia(media string) string {
	switch strings.ToLower(strings.TrimSpace(media)) {
	case "a4":
		return "iso_a4_210x297mm"
	case "a5":
		return "iso_a5_148x210mm"
	case "a3":
		return "iso_a3_297x420mm"
	case "letter":
		return "na_letter_8.5x11in"
	case "legal":
		return "na_legal_8.5x14in"
	case "4x6 photo":
		return "na_index-4x6_4x6in"
	case "5x7 photo":
		return "na_index-5x7_5x7in"
	default:
		return media
	}
}

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
