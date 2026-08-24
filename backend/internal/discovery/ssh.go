package discovery

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// IsSSHURL reports whether the CUPS URL uses the ssh:// transport.
// Format: ssh://user@host or ssh://user@host:port
func IsSSHURL(cupsURL string) bool {
	cupsURL = strings.TrimSpace(cupsURL)
	return strings.HasPrefix(cupsURL, "ssh://")
}

// NormalizeSSHHost converts "ssh://amba@100.90.80.85" -> "amba@100.90.80.85".
func NormalizeSSHHost(cupsURL string) string {
	cupsURL = strings.TrimSpace(cupsURL)
	cupsURL = strings.TrimPrefix(cupsURL, "ssh://")
	cupsURL = strings.TrimSuffix(cupsURL, "/")
	return cupsURL
}

// sshRun runs a command on the remote host via SSH (BatchMode, no password).
// On Windows it routes through WSL (which holds the SSH keys/config);
// on Linux (production) it uses ssh directly.
// Returns combined stdout. Stderr is folded into the error.
func sshRun(userHost, remoteCmd string, stdinData []byte) (string, error) {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// WSL holds the SSH keys (e.g. ~/.ssh/id_ed25519 + pc-hitam config)
		args := []string{"-e", "bash", "-lc", "ssh -o BatchMode=yes -o ConnectTimeout=8 " + userHost + " " + shellQuote(remoteCmd)}
		cmd = exec.Command("wsl", args...)
	} else {
		args := []string{"-o", "BatchMode=yes", "-o", "ConnectTimeout=8", userHost, remoteCmd}
		cmd = exec.Command("ssh", args...)
	}
	if len(stdinData) > 0 {
		cmd.Stdin = bytes.NewReader(stdinData)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("ssh %s: %s", userHost, msg)
	}
	return string(out), nil
}

// ShellQuote wraps s in single quotes for POSIX sh (WSL path).
func ShellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func shellQuote(s string) string {
	return ShellQuote(s)
}

// SSHRunSimple runs a remote command and returns its stdout.
func SSHRunSimple(userHost, remoteCmd string) (string, error) {
	return sshRun(userHost, remoteCmd, nil)
}

// SSHWriteFile safely uploads binary data to remote path via base64 decoding.
// This is 100% binary-safe and immune to UTF-8 corruption or CRLF mangling.
func SSHWriteFile(userHost, remotePath string, data []byte) (string, error) {
	b64 := base64.StdEncoding.EncodeToString(data)
	return sshRun(userHost, fmt.Sprintf("base64 -d > %s && stat -c %%s %s", shellQuote(remotePath), shellQuote(remotePath)), []byte(b64))
}

// SSHReadFile downloads a remote file via ssh (base64 of cat).
func SSHReadFile(userHost, remotePath string) ([]byte, error) {
	out, err := sshRun(userHost, fmt.Sprintf("base64 -w0 %s 2>/dev/null", shellQuote(remotePath)), nil)
	if err != nil {
		return nil, err
	}
	b64 := strings.TrimSpace(out)
	if b64 == "" {
		return nil, fmt.Errorf("remote file empty or missing: %s", remotePath)
	}
	return base64.StdEncoding.DecodeString(b64)
}

// SSHRasterizePDF uploads a local PDF to the remote host, rasterizes every
// page to PNG with ghostscript, and returns the remote PNG paths.
// This avoids cups-filters pdftopdf crashing on invalid /Rotate values.
func SSHRasterizePDF(userHost, localPDFPath string, grayscale bool, quality string) ([]string, error) {
	data, err := os.ReadFile(localPDFPath)
	if err != nil {
		return nil, fmt.Errorf("read pdf: %w", err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("empty pdf")
	}
	ts := time.Now().UnixNano()
	base := fmt.Sprintf("/tmp/kp-%d", ts)
	pdfRemote := base + ".pdf"

	// Upload PDF (stdin pipe)
	if _, err := sshRun(userHost, fmt.Sprintf("cat > %s", shellQuote(pdfRemote)), data); err != nil {
		return nil, fmt.Errorf("upload pdf: %w", err)
	}
	cleanup := func() {
		_, _ = sshRun(userHost, fmt.Sprintf("rm -f %s-*.png %s", base, pdfRemote), nil)
	}

	gsDevice := "png16m"
	if grayscale {
		gsDevice = "pnggray"
	}

	dpi := "300"
	if quality == "Draft" {
		dpi = "150"
	}

	// Rasterize all pages to PNG
	out, err := sshRun(userHost,
		fmt.Sprintf("gs -q -dSAFER -dNOPAUSE -dBATCH -sDEVICE=%s -r%s -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile=%s-%%d.png %s 2>&1 && ls %s-*.png", gsDevice, dpi, base, pdfRemote, base), nil)
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("gs rasterize: %w", err)
	}

	var files []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, base+"-") && strings.HasSuffix(line, ".png") {
			files = append(files, line)
		}
	}
	if len(files) == 0 {
		cleanup()
		return nil, fmt.Errorf("rasterize produced no pages: %s", strings.TrimSpace(out))
	}
	return files, nil
}

// SSHRemoveFiles removes remote files (best-effort cleanup).
func SSHRemoveFiles(userHost string, paths []string) {
	if len(paths) == 0 {
		return
	}
	quoted := make([]string, 0, len(paths))
	for _, p := range paths {
		quoted = append(quoted, shellQuote(p))
	}
	_, _ = sshRun(userHost, "rm -f "+strings.Join(quoted, " "), nil)
}

// SSHSubmitJobRemote prints multiple remote files (e.g. rasterized PNGs) via
// a single `lp -d NAME -o ... file1 file2...` command. Returns the CUPS job id.
func SSHSubmitJobRemote(userHost, printerName string, remoteFiles []string, opts JobOptions) (int, error) {
	if len(remoteFiles) == 0 {
		return 0, fmt.Errorf("no files to submit")
	}
	var flags []string
	if opts.Media != "" {
		// Use PPD-native short names for lp -o media=; Epson PPD has "A4" not "iso_a4_210x297mm"
		flags = append(flags, fmt.Sprintf("media=%s", normalizeMediaPPD(opts.Media)))
	}
	if opts.Sides != "" {
		flags = append(flags, fmt.Sprintf("sides=%q", opts.Sides))
	}
	if opts.ColorMode == "grayscale" || opts.ColorMode == "monochrome" {
		// Only use the PPD-native Ink= option. DO NOT add print-color-mode or ColorModel:
		// those force a 1-channel raster that Epson ESC/P-R driver cannot decode (blank pages).
		flags = append(flags, "Ink=MONO")
	} else if opts.ColorMode == "color" {
		flags = append(flags, "Ink=COLOR")
	}
	if opts.FileType != "" {
		flags = append(flags, fmt.Sprintf("document-format=%s", opts.FileType))
	}
	if opts.Quality != "" {
		switch strings.ToLower(opts.Quality) {
		case "draft":
			flags = append(flags, "print-quality=3", "MediaType=PLAIN_NORMAL")
		case "high":
			flags = append(flags, "print-quality=5", "MediaType=PLAIN_HIGH")
		case "photo":
			flags = append(flags, "print-quality=5", "MediaType=PMPHOTO_HIGH")
		default:
			if strings.Contains(strings.ToLower(opts.Quality), "dpi") || strings.Contains(opts.Quality, "x") {
				flags = append(flags, fmt.Sprintf("Resolution=%q", opts.Quality))
			} else {
				flags = append(flags, fmt.Sprintf("print-quality=%s", qualityToIPP(opts.Quality)))
			}
		}
	}
	if opts.Copies > 1 {
		flags = append(flags, fmt.Sprintf("copies=%d", opts.Copies))
	}
	if opts.PageRange != "" {
		// lp -P accepts CUPS page-ranges format: "1", "1-5", "1,3,5-7"
		flags = append(flags, fmt.Sprintf("page-ranges=%s", normalizePageRange(opts.PageRange)))
	}
	jobName := opts.JobName
	if jobName == "" {
		jobName = "kroomprint-job"
	}
	optStr := ""
	if len(flags) > 0 {
		optStr = " -o " + strings.Join(flags, " -o ")
	}
	quoted := make([]string, 0, len(remoteFiles))
	for _, f := range remoteFiles {
		quoted = append(quoted, shellQuote(f))
	}
	remoteCmd := fmt.Sprintf("lp -d %s -t %s%s %s", shellQuote(printerName), shellQuote(jobName), optStr, strings.Join(quoted, " "))
	out, err := sshRun(userHost, remoteCmd, nil)
	if err != nil {
		return 0, err
	}
	jobID := 0
	if i := strings.LastIndex(out, "-"); i >= 0 {
		idStr := strings.TrimSpace(out[i+1:])
		if j := strings.IndexAny(idStr, " )"); j > 0 {
			idStr = idStr[:j]
		}
		if n, err := strconv.Atoi(idStr); err == nil {
			jobID = n
		}
	}
	return jobID, nil
}

// normalizeMediaPPD maps UI media labels to PPD-native PageSize names used by `lp -o media=`.
// Epson L3210 PPD uses short names: "A4", "A5", "Letter", "Legal", etc.
// Do NOT use IPP long-form names like "iso_a4_210x297mm" — those are not recognized by the PPD.
func normalizeMediaPPD(media string) string {
	switch strings.ToLower(strings.TrimSpace(media)) {
	case "a4":
		return "A4"
	case "a5":
		return "A5"
	case "a6":
		return "A6"
	case "a3":
		return "A3"
	case "b5":
		return "B5"
	case "b6":
		return "B6"
	case "letter":
		return "Letter"
	case "legal":
		return "Legal"
	case "4x6 photo", "4x6":
		return "4X6FULL"
	case "5x7 photo", "5x7":
		return "8x10"
	default:
		// Return as-is (caller may already have correct PPD name)
		return media
	}
}

// normalizePageRange converts user input page range to CUPS page-ranges format.
// Input: "1" | "1-5" | "1, 3, 5-7" | "all" -> Output: "1" | "1-5" | "1,3,5-7" | ""
func normalizePageRange(r string) string {
	r = strings.TrimSpace(r)
	if r == "" || strings.EqualFold(r, "all") {
		return ""
	}
	// Strip spaces around commas and dashes for CUPS compatibility
	r = strings.ReplaceAll(r, " ", "")
	return r
}

// SSHGetJobStatus queries the state of a CUPS job (id) on the remote host.
// Returns "completed", "cancelled", "printing", "failed", or "notfound".
// Uses `lpstat -o` (active queue) and `lpstat -W completed` (finished jobs).
func SSHGetJobStatus(userHost, printerName string, jobID int) (string, error) {
	prefix := fmt.Sprintf("%s-%d", printerName, jobID)

	// Active queue only (lpstat -o defaults to -W not-completed)
	out, err := sshRun(userHost, fmt.Sprintf("lpstat -o %s 2>/dev/null", shellQuote(printerName)), nil)
	if err != nil {
		return "unknown", err
	}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) > 0 && (fields[0] == prefix || strings.HasPrefix(fields[0], prefix+"\t") || strings.HasPrefix(fields[0], prefix+" ")) {
			return "printing", nil
		}
	}

	// Completed jobs
	outC, err := sshRun(userHost, fmt.Sprintf("lpstat -W completed -o %s 2>/dev/null", shellQuote(printerName)), nil)
	if err == nil {
		for _, line := range strings.Split(outC, "\n") {
			fields := strings.Fields(strings.TrimSpace(line))
			if len(fields) > 0 && (fields[0] == prefix || strings.HasPrefix(fields[0], prefix+"\t") || strings.HasPrefix(fields[0], prefix+" ")) {
				return "completed", nil
			}
		}
	}
	return "notfound", nil
}

// SSHPrinterState queries the current state of a CUPS printer.
// Returns raw `lpstat -l -p NAME` output.
func SSHPrinterState(userHost, printerName string) (string, error) {
	out, err := sshRun(userHost, fmt.Sprintf("lpstat -l -p %s 2>/dev/null", shellQuote(printerName)), nil)
	return out, err
}

// SSHListActiveJobs returns the set of active CUPS job ids (queue) for a printer.
func SSHListActiveJobs(userHost, printerName string) (map[int]bool, error) {
	out, err := sshRun(userHost, fmt.Sprintf("lpstat -o %s 2>/dev/null", shellQuote(printerName)), nil)
	if err != nil {
		return nil, err
	}
	jobs := map[int]bool{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) == 0 {
			continue
		}
		// Format: PRINTER-123 user size date
		if i := strings.LastIndex(fields[0], "-"); i > 0 {
			if n, err := strconv.Atoi(fields[0][i+1:]); err == nil {
				jobs[n] = true
			}
		}
	}
	return jobs, nil
}

// SSHListPrinters enumerates printers registered on a remote CUPS via
// `lpstat -p -e`. Returns printer names (and descriptions when available).
func SSHListPrinters(userHost string) ([]PrinterInfo, error) {
	out, err := sshRun(userHost, "lpstat -p -e 2>/dev/null; echo '---'; lpstat -d 2>/dev/null", nil)
	if err != nil {
		return nil, err
	}
	var printers []PrinterInfo
	seen := map[string]bool{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line == "---" || strings.HasPrefix(line, "system default") {
			continue
		}
		// Format: "printer NAME is idle. enabled since ..." or "NAME"
		name := ""
		if strings.HasPrefix(line, "printer ") {
			rest := line[len("printer "):]
			if i := strings.Index(rest, " "); i > 0 {
				name = rest[:i]
			}
		} else {
			name = strings.Fields(line)[0]
		}
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		printers = append(printers, PrinterInfo{
			Name: name,
			URI:  "ipp://" + name,
		})
	}
	return printers, nil
}

// SSHProbePrinter queries printer capabilities via `lpoptions -p NAME -l`
// and `lpstat -l -p NAME`. Returns a Capabilities struct.
func SSHProbePrinter(userHost, printerName string) (*Capabilities, error) {
	out, err := sshRun(userHost, fmt.Sprintf("lpoptions -p %s -l 2>/dev/null", shellQuote(printerName)), nil)
	if err != nil {
		// Some CUPS setups restrict lpoptions; fall back to conservative caps.
		return usbCaps(), nil
	}
	caps := &Capabilities{
		PaperSizes:   []string{"A4", "A5", "Letter", "Legal", "4x6 Photo"},
		Qualities:    []string{"Draft", "Standard", "High", "Photo"},
		Scalings:     defaultScalings(),
		Orientations: defaultOrients(),
		Duplex:       false,
		Color:        true,
		MaxCopies:    999,
	}

	var parsedSizes []string
	seenSizes := map[string]bool{}

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		colon := strings.Index(line, ":")
		if colon < 0 {
			continue
		}
		key := strings.TrimSpace(line[:colon])
		vals := strings.Fields(line[colon+1:])
		var clean []string
		for _, v := range vals {
			v = strings.TrimPrefix(v, "*")
			if v != "" && !strings.Contains(v, ".") {
				clean = append(clean, v)
			}
		}
		lowKey := strings.ToLower(key)
		switch {
		case strings.Contains(lowKey, "pagesize") || strings.Contains(lowKey, "media size") || strings.Contains(lowKey, "media"):
			for _, sz := range clean {
				norm := cleanMediaName(sz)
				if !seenSizes[norm] && norm != "" {
					seenSizes[norm] = true
					parsedSizes = append(parsedSizes, norm)
				}
			}
		case strings.Contains(lowKey, "ink") || strings.Contains(lowKey, "colormodel") || strings.Contains(lowKey, "color"):
			for _, c := range clean {
				if strings.EqualFold(c, "color") || strings.EqualFold(c, "rgb") || strings.EqualFold(c, "cmyk") {
					caps.Color = true
				}
			}
		case strings.Contains(lowKey, "duplex") || strings.Contains(lowKey, "sides"):
			if len(clean) > 0 {
				caps.Duplex = true
			}
		}
	}

	if len(parsedSizes) > 0 {
		caps.PaperSizes = parsedSizes
	}
	return caps, nil
}

func cleanMediaName(m string) string {
	clean := strings.TrimPrefix(m, "*")
	lower := strings.ToLower(clean)
	switch lower {
	case "a4":
		return "A4"
	case "a5":
		return "A5"
	case "a6":
		return "A6"
	case "a3":
		return "A3"
	case "letter":
		return "Letter"
	case "legal":
		return "Legal"
	case "b5":
		return "B5"
	case "4x6full", "t4x6full", "4x6", "4x7", "t4x7":
		return "4x6 Photo"
	case "5x7", "8x10":
		return "5x7 Photo"
	default:
		return clean
	}
}

// SSHSubmitJob uploads the file to the remote host and submits it to CUPS via `lp`.
// Returns the CUPS job id.
func SSHSubmitJob(userHost, printerName, filePath string, opts JobOptions) (int, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return 0, fmt.Errorf("read file: %w", err)
	}
	if len(data) == 0 {
		return 0, fmt.Errorf("empty document")
	}

	remoteTmp := fmt.Sprintf("/tmp/kp-job-%d-%s", time.Now().UnixNano(), filepath.Base(filePath))
	if _, err := SSHWriteFile(userHost, remoteTmp, data); err != nil {
		return 0, fmt.Errorf("upload print file: %w", err)
	}
	defer func() {
		go func() {
			time.Sleep(30 * time.Second)
			_, _ = SSHRunSimple(userHost, "rm -f "+shellQuote(remoteTmp))
		}()
	}()

	var flags []string
	if opts.Media != "" {
		// Use PPD-native short names for lp -o media=; Epson PPD has "A4" not "iso_a4_210x297mm"
		flags = append(flags, fmt.Sprintf("media=%s", normalizeMediaPPD(opts.Media)))
	}
	if opts.Sides != "" && opts.Sides != "one-sided" {
		flags = append(flags, fmt.Sprintf("sides=%s", opts.Sides))
	}
	if opts.ColorMode == "grayscale" || opts.ColorMode == "monochrome" {
		// Only Ink=MONO: DO NOT add print-color-mode=monochrome or ColorModel=Gray.
		// Those change raster to 1-channel which Epson ESC/P-R driver cannot decode → blank page.
		flags = append(flags, "Ink=MONO")
	} else if opts.ColorMode == "color" {
		flags = append(flags, "Ink=COLOR")
	}
	if opts.Quality != "" {
		switch strings.ToLower(opts.Quality) {
		case "draft":
			flags = append(flags, "MediaType=PLAIN_NORMAL")
		case "high", "best":
			flags = append(flags, "MediaType=PLAIN_HIGH")
		case "photo":
			flags = append(flags, "MediaType=PMPHOTO_HIGH")
		default:
			flags = append(flags, "MediaType=PLAIN_NORMAL")
		}
	}
	if opts.Copies > 1 {
		flags = append(flags, fmt.Sprintf("copies=%d", opts.Copies))
	}
	if opts.PageRange != "" {
		// lp -P accepts CUPS page-ranges format: "1", "1-5", "1,3,5-7"
		flags = append(flags, fmt.Sprintf("page-ranges=%s", normalizePageRange(opts.PageRange)))
	}
	jobName := opts.JobName
	if jobName == "" {
		jobName = "kroomprint-job"
	}

	optStr := ""
	if len(flags) > 0 {
		optStr = " -o " + strings.Join(flags, " -o ")
	}
	// Ensure printer is enabled before submitting (CUPS auto-disables on errors).
	_, _ = sshRun(userHost, fmt.Sprintf("cupsenable %s 2>/dev/null; cupsaccept %s 2>/dev/null", shellQuote(printerName), shellQuote(printerName)), nil)
	remoteCmd := fmt.Sprintf("lp -d %s -t %s%s %s", shellQuote(printerName), shellQuote(jobName), optStr, shellQuote(remoteTmp))

	out, err := sshRun(userHost, remoteCmd, nil)
	if err != nil {
		return 0, err
	}
	// Output like: "request id is L3210-Series-12 (1 file(s))"
	jobID := 0
	if i := strings.LastIndex(out, "-"); i >= 0 {
		idStr := strings.TrimSpace(out[i+1:])
		if j := strings.IndexAny(idStr, " )"); j > 0 {
			idStr = idStr[:j]
		}
		if n, err := strconv.Atoi(idStr); err == nil {
			jobID = n
		}
	}
	return jobID, nil
}
