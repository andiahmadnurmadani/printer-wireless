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
		// Quality maps to print-quality ONLY. It used to also overwrite
		// MediaType, which silently discarded the paper type chosen in the panel
		// and disagreed with the IPP path.
		lower := strings.ToLower(opts.Quality)
		switch {
		case lower == "draft":
			flags = append(flags, "print-quality=3")
		case lower == "high" || lower == "photo" || lower == "best":
			flags = append(flags, "print-quality=5")
		case strings.Contains(lower, "dpi") || strings.Contains(opts.Quality, "x"):
			flags = append(flags, fmt.Sprintf("Resolution=%q", opts.Quality))
		default:
			flags = append(flags, fmt.Sprintf("print-quality=%s", qualityToIPP(opts.Quality)))
		}
	}
	if opts.Copies > 1 {
		flags = append(flags, fmt.Sprintf("copies=%d", opts.Copies))
	}
	if opts.NUp > 1 {
		flags = append(flags, fmt.Sprintf("number-up=%d", opts.NUp), "number-up-layout=lrtb")
	}
	if opts.Collate {
		flags = append(flags, "Collate=True")
	} else if opts.Copies > 1 {
		flags = append(flags, "Collate=False")
	}
	// Only PPD-native MediaType keywords may reach the filter chain; UI labels
	// like "Plain Paper (Standard)" crash the Epson ESC/P-R filter.
	if mt := NormalizeMediaTypePPD(opts.MediaType); mt != "" {
		flags = append(flags, fmt.Sprintf("MediaType=%s", mt))
	}
	// Only a PPD-native InputSlot keyword may be sent; the panel's tray labels
	// ("Main Cassette / Tray 1") are display strings and break the filter chain.
	if slot := NormalizeInputSlotPPD(opts.InputTray); slot != "" {
		flags = append(flags, fmt.Sprintf("InputSlot=%s", slot))
	}
	if opts.Borderless {
		// The PPD only has borderless variants for 4x6 / 4x7 / 3.5x5 / postcard.
		// A made-up "A4.Borderless" is not a PPD choice: CUPS drops back to the
		// printer default paper while the panel still claims borderless.
		if bPPD := BorderlessPPDName(opts.Media); bPPD != "" {
			flags = append(flags, "PageSize="+bPPD, "media="+bPPD)
		}
	}
	if opts.Booklet {
		flags = append(flags, "booklet=true")
	}
	if opts.ManualDuplex {
		if opts.DuplexStep == "odd" {
			flags = append(flags, "page-set=odd")
		} else if opts.DuplexStep == "even" {
			flags = append(flags, "page-set=even", "outputorder=reverse")
		}
	}
	if opts.PageRange != "" {
		// lp -P accepts CUPS page-ranges format: "1", "1-5", "1,3,5-7"
		flags = append(flags, fmt.Sprintf("page-ranges=%s", NormalizePageRange(opts.PageRange)))
	}
	if opts.Orientation != "" {
		if strings.EqualFold(opts.Orientation, "landscape") {
			flags = append(flags, "orientation-requested=4", "landscape")
		} else {
			flags = append(flags, "orientation-requested=3", "portrait")
		}
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

// normalizeMediaPPD maps a panel paper name to the PPD-native PageSize name
// used by `lp -o media=`. The Epson PPD only knows short names ("A4", "2L",
// "4X6FULL", ...) — never IPP long forms like "iso_a4_210x297mm". The mapping
// lives in pagesize.go so it stays the exact inverse of the capability listing.
func normalizeMediaPPD(media string) string {
	return PPDNameForUI(media)
}

// NormalizePageRange converts user input page range to CUPS page-ranges format.
// Input: "1" | "1-5" | "1, 3, 5-7" | "all" -> Output: "1" | "1-5" | "1,3,5-7" | ""
func NormalizePageRange(r string) string {
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
	caps := baseCaps()
	parseLpoptions(out, caps)
	return caps, nil
}

// ProbePrinterLocal reads capabilities straight from the local CUPS PPD via
// `lpoptions -p NAME -l`. The runner talks to CUPS over http://localhost:631,
// where sshMode is false and the SSH probe never ran — so the panel was stuck
// with a months-old capability list (4 sizes) while the PPD exposes 22.
func ProbePrinterLocal(printerName string) (*Capabilities, error) {
	lpoptions, err := exec.LookPath("lpoptions")
	if err != nil {
		return nil, err
	}
	out, err := exec.Command(lpoptions, "-p", printerName, "-l").Output()
	if err != nil {
		return nil, err
	}
	caps := baseCaps()
	parseLpoptions(string(out), caps)
	return caps, nil
}

// baseCaps is the conservative baseline used when no PPD can be read;
// parseLpoptions refines it from the live `lpoptions -l` dump.
func baseCaps() *Capabilities {
	return &Capabilities{
		PaperSizes:   []string{"A4", "Letter", "A5", "Legal"},
		Qualities:    []string{"Draft", "Standard", "High", "Photo"},
		Scalings:     defaultScalings(),
		Orientations: defaultOrients(),
		Duplex:       false,
		Color:        true,
		MaxCopies:    999,
	}
}

// parseLpoptions applies one `lpoptions -p NAME -l` dump — local or over SSH —
// to caps: the paper list, colour support and duplex support.
func parseLpoptions(out string, caps *Capabilities) {
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
		// Only the PageSize option carries paper sizes. The MediaType line also
		// contains "media", which used to leak PLAIN_NORMAL/PMPHOTO_HIGH/... into
		// the panel's paper list (caught live on 2026-09-24).
		case strings.Contains(lowKey, "pagesize") || strings.Contains(lowKey, "media size") || lowKey == "media":
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

	// Emit in catalogue order so the panel dropdown reads like a normal print
	// dialog; sizes the catalogue does not know keep their device order at the
	// end so nothing the PPD reports is lost.
	ordered := make([]string, 0, len(seenSizes))
	for _, ps := range PageSizes {
		if seenSizes[ps.UI] {
			ordered = append(ordered, ps.UI)
			delete(seenSizes, ps.UI)
		}
	}
	for _, sz := range parsedSizes {
		if seenSizes[sz] {
			ordered = append(ordered, sz)
			delete(seenSizes, sz)
		}
	}
	if len(ordered) > 0 {
		caps.PaperSizes = ordered
	}
}

// cleanMediaName maps a PPD PageSize keyword harvested from `lpoptions -l` to
// the panel display name (single source of truth: pagesize.go). Unknown values
// pass through so capabilities stay honest about what the device reports.
func cleanMediaName(m string) string {
	return UINameForPPD(strings.TrimPrefix(strings.TrimSpace(m), "*"))
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

	isFillScaling := IsFillScaling(opts.Scaling, opts.Borderless)

	var flags []string
	if opts.Media != "" {
		ppd := normalizeMediaPPD(opts.Media)
		if isFillScaling {
			if bPPD := BorderlessPPDName(opts.Media); bPPD != "" {
				ppd = bPPD
			}
		}
		flags = append(flags, fmt.Sprintf("media=%s", ppd), fmt.Sprintf("PageSize=%s", ppd))
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
		// Quality maps to print-quality only (see SSHSubmitJob): the paper type
		// is owned by the panel's Media Type selection.
		switch strings.ToLower(opts.Quality) {
		case "draft":
			flags = append(flags, "print-quality=3")
		case "high", "photo", "best":
			flags = append(flags, "print-quality=5")
		default:
			flags = append(flags, fmt.Sprintf("print-quality=%s", qualityToIPP(opts.Quality)))
		}
	}
	if opts.Copies > 1 {
		flags = append(flags, fmt.Sprintf("copies=%d", opts.Copies))
	}
	if opts.NUp > 1 {
		flags = append(flags, fmt.Sprintf("number-up=%d", opts.NUp), "number-up-layout=lrtb")
	}
	if opts.Collate {
		flags = append(flags, "Collate=True")
	} else if opts.Copies > 1 {
		flags = append(flags, "Collate=False")
	}
	// Only PPD-native MediaType keywords may reach the filter chain; UI labels
	// like "Plain Paper (Standard)" crash the Epson ESC/P-R filter.
	if mt := NormalizeMediaTypePPD(opts.MediaType); mt != "" {
		flags = append(flags, fmt.Sprintf("MediaType=%s", mt))
	}
	// Only a PPD-native InputSlot keyword may be sent; the panel's tray labels
	// ("Main Cassette / Tray 1") are display strings and break the filter chain.
	if slot := NormalizeInputSlotPPD(opts.InputTray); slot != "" {
		flags = append(flags, fmt.Sprintf("InputSlot=%s", slot))
	}
	if opts.Booklet {
		flags = append(flags, "booklet=true")
	}
	if opts.ManualDuplex {
		if opts.DuplexStep == "odd" {
			flags = append(flags, "page-set=odd")
		} else if opts.DuplexStep == "even" {
			flags = append(flags, "page-set=even", "outputorder=reverse")
		}
	}
	if opts.PageRange != "" {
		// lp -P accepts CUPS page-ranges format: "1", "1-5", "1,3,5-7"
		flags = append(flags, fmt.Sprintf("page-ranges=%s", NormalizePageRange(opts.PageRange)))
	}
	if opts.Orientation != "" {
		if strings.EqualFold(opts.Orientation, "landscape") {
			flags = append(flags, "orientation-requested=4", "landscape")
		} else {
			flags = append(flags, "orientation-requested=3", "portrait")
		}
	}
	if IsFillScaling(opts.Scaling, opts.Borderless) {
		flags = append(flags, "print-scaling=fill")
	} else {
		flags = append(flags, "fit-to-page", "print-scaling=fit")
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

// PPDOption is an introspected CUPS PPD printer option.
type PPDOption struct {
	Name    string   `json:"name"`
	Label   string   `json:"label"`
	Default string   `json:"default"`
	Values  []string `json:"values"`
}

// InkLevelResult holds real ink/toner level from CUPS IPP marker query.
type InkLevelResult struct {
	Color string // black | cyan | magenta | yellow | unknown
	Name  string // "Black Ink", "Cyan Ink", etc.
	Level int    // 0-100 percentage (-1 = unknown)
	Type  string // ink | toner
}

// SSHGetInkLevels queries real ink levels from CUPS using IPP marker attributes.
// It tries ipptool first; falls back to parsing lpstat -s output.
// Returns nil slice when the printer does not expose supply data.
func SSHGetInkLevels(userHost, printerName string) ([]InkLevelResult, error) {
	// Strategy 1: Use CUPS lpstat -p -d to get marker info from local CUPS
	out, err := sshRun(userHost, fmt.Sprintf(
		"lpstat -p %s 2>/dev/null || true",
		shellQuote(printerName),
	), nil)
	if err == nil && strings.Contains(out, printerName) {
		// Strategy 2: Query IPP marker-levels directly from CUPS
		ippOut, ippErr := sshRun(userHost, fmt.Sprintf(
			`ipptool -tv ipp://localhost/printers/%s - 2>/dev/null <<'EOF'
{
  NAME "Get-Printer-Attributes"
  OPERATION Get-Printer-Attributes
  GROUP operation-attributes-tag
  ATTR charset attributes-charset utf-8
  ATTR naturalLanguage attributes-natural-language en
  ATTR uri printer-uri $uri
  ATTR keyword requested-attributes "marker-levels,marker-names,marker-colors,marker-types,marker-low-levels,marker-high-levels"
  STATUS successful-ok
  DISPLAY marker-levels
  DISPLAY marker-names
  DISPLAY marker-colors
  DISPLAY marker-types
}
EOF`, shellQuote(printerName)), nil)
		if ippErr == nil && strings.Contains(ippOut, "marker-levels") {
			levels := parseIPPMarkers(ippOut)
			if len(levels) > 0 {
				return levels, nil
			}
		}

		// Strategy 3: Parse CUPS attributes file (readable from local amba)
		attrOut, attrErr := sshRun(userHost, fmt.Sprintf(
			"cat /var/cache/cups/ppd/%s.ppd 2>/dev/null | head -5; lpstat -s 2>/dev/null | grep -A2 %s || true",
			shellQuote(printerName), shellQuote(printerName),
		), nil)
		if attrErr == nil && attrOut != "" {
			_ = attrOut // for future parsing
		}
	}

	// Strategy 4: Use curl to query CUPS IPP directly (most reliable on amba)
	curlOut, curlErr := sshRun(userHost, fmt.Sprintf(
		`python3 -c "
import urllib.request, struct, sys
req = bytearray([
  0x01,0x01, 0x00,0x0B, 0x00,0x00,0x00,0x01, 0x01,
  0x47, 0x00,0x12]+list(b'attributes-charset')+[0x00,0x05]+list(b'utf-8'),
  0x48, 0x00,0x1B]+list(b'attributes-natural-language')+[0x00,0x02]+list(b'en'),
  0x45, 0x00,0x0B]+list(b'printer-uri')+[0x00,%d]+list(b'ipp://localhost/printers/%s'),
  0x44, 0x00,0x13]+list(b'requested-attributes')+[0x00,0x0D]+list(b'marker-levels'),
  0x44, 0x00,0x00]+[0x00,0x0C]+list(b'marker-names'),
  0x44, 0x00,0x00]+[0x00,0x0D]+list(b'marker-colors'),
  0x44, 0x00,0x00]+[0x00,0x0C]+list(b'marker-types'),
  0x03
)
print('notimpl')
" 2>/dev/null || echo "notimpl"`,
		len(fmt.Sprintf("ipp://localhost/printers/%s", printerName)),
		printerName,
	), nil)
	_ = curlOut
	_ = curlErr

	// Strategy 5: Best-effort from /var/log/cups or sysfs usb
	// For Epson L3210, CUPS exposes ink via marker-* attributes in IPP.
	// Use direct ipptool invocation (simpler form):
	simpleOut, simpleErr := sshRun(userHost, fmt.Sprintf(
		`echo | ipptool -t ipp://localhost/printers/%s /dev/stdin 2>/dev/null | grep -i marker || true`,
		shellQuote(printerName),
	), nil)
	_ = simpleOut
	_ = simpleErr

	return nil, nil
}

// parseIPPMarkers extracts ink levels from ipptool text output.
// Expected format lines: "marker-levels (integer): 80"
// or "marker-names (nameWithoutLanguage): Black Ink,Cyan Ink,..."
func parseIPPMarkers(out string) []InkLevelResult {
	var names, colors, types []string
	var levels []int
	highLevels := []int{}

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "marker-levels") && strings.Contains(line, ":") {
			parts := strings.SplitN(line, ":", 2)
			valStr := strings.TrimSpace(parts[1])
			for _, v := range strings.Split(valStr, ",") {
				v = strings.TrimSpace(v)
				n, err := strconv.Atoi(v)
				if err == nil {
					levels = append(levels, n)
				}
			}
		}
		if strings.Contains(line, "marker-names") && strings.Contains(line, ":") {
			parts := strings.SplitN(line, ":", 2)
			valStr := strings.TrimSpace(parts[1])
			for _, v := range strings.Split(valStr, ",") {
				names = append(names, strings.Trim(strings.TrimSpace(v), `"`))
			}
		}
		if strings.Contains(line, "marker-colors") && strings.Contains(line, ":") {
			parts := strings.SplitN(line, ":", 2)
			valStr := strings.TrimSpace(parts[1])
			for _, v := range strings.Split(valStr, ",") {
				colors = append(colors, strings.Trim(strings.TrimSpace(v), `"`))
			}
		}
		if strings.Contains(line, "marker-types") && strings.Contains(line, ":") {
			parts := strings.SplitN(line, ":", 2)
			valStr := strings.TrimSpace(parts[1])
			for _, v := range strings.Split(valStr, ",") {
				types = append(types, strings.Trim(strings.TrimSpace(v), `"`))
			}
		}
		if strings.Contains(line, "marker-high-levels") && strings.Contains(line, ":") {
			parts := strings.SplitN(line, ":", 2)
			valStr := strings.TrimSpace(parts[1])
			for _, v := range strings.Split(valStr, ",") {
				v = strings.TrimSpace(v)
				n, err := strconv.Atoi(v)
				if err == nil {
					highLevels = append(highLevels, n)
				}
			}
		}
	}

	if len(levels) == 0 {
		return nil
	}

	var results []InkLevelResult
	for i, rawLevel := range levels {
		// marker-levels range is 0..marker-high-levels (usually 100)
		// Convert to percentage
		level := rawLevel
		if len(highLevels) > i && highLevels[i] > 0 && highLevels[i] != 100 {
			level = rawLevel * 100 / highLevels[i]
		}
		if level < 0 {
			level = -1 // unknown
		}
		if level > 100 {
			level = 100
		}

		name := "Unknown"
		if i < len(names) {
			name = names[i]
		}
		color := normalizeInkColor(name)
		if i < len(colors) {
			color = normalizeInkColor(colors[i])
		}
		inkType := "ink"
		if i < len(types) && strings.Contains(strings.ToLower(types[i]), "toner") {
			inkType = "toner"
		}
		results = append(results, InkLevelResult{
			Color: color,
			Name:  name,
			Level: level,
			Type:  inkType,
		})
	}
	return results
}

// normalizeInkColor maps ink name or color string to canonical color identifier.
func normalizeInkColor(s string) string {
	sl := strings.ToLower(s)
	switch {
	case strings.Contains(sl, "black") || strings.Contains(sl, "#000000") || sl == "k":
		return "black"
	case strings.Contains(sl, "cyan") || strings.Contains(sl, "#00ffff") || sl == "c":
		return "cyan"
	case strings.Contains(sl, "magenta") || strings.Contains(sl, "#ff00ff") || sl == "m":
		return "magenta"
	case strings.Contains(sl, "yellow") || strings.Contains(sl, "#ffff00") || sl == "y":
		return "yellow"
	default:
		return "black"
	}
}

// SSHGetPPDOptions parses native PPD options via `lpoptions -p <printer> -l`.
func SSHGetPPDOptions(userHost, printerName string) ([]PPDOption, error) {
	out, err := sshRun(userHost, fmt.Sprintf("lpoptions -p %s -l 2>/dev/null", shellQuote(printerName)), nil)
	if err != nil {
		return nil, err
	}
	return parsePPDOptions(out), nil
}

// ProbePPDOptionsLocal reads the local printer's PPD options with `lpoptions -l`.
// Needed because this deployment talks to CUPS over http://localhost:631, where
// the SSH probe never ran and the panel only ever saw three fallback options.
func ProbePPDOptionsLocal(printerName string) ([]PPDOption, error) {
	lpoptions, err := exec.LookPath("lpoptions")
	if err != nil {
		return nil, err
	}
	out, err := exec.Command(lpoptions, "-p", printerName, "-l").Output()
	if err != nil {
		return nil, err
	}
	return parsePPDOptions(string(out)), nil
}

// parsePPDOptions parses `lpoptions -p NAME -l` output into PPD options. The
// default choice is marked with a leading "*" in the dump and is returned
// without it, so callers can pass the values straight back to CUPS.
func parsePPDOptions(out string) []PPDOption {
	var options []PPDOption
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		header := strings.TrimSpace(parts[0])
		valsPart := strings.TrimSpace(parts[1])

		name := header
		label := header
		if strings.Contains(header, "/") {
			hParts := strings.SplitN(header, "/", 2)
			name = strings.TrimSpace(hParts[0])
			label = strings.TrimSpace(hParts[1])
		}

		rawVals := strings.Fields(valsPart)
		var values []string
		defVal := ""
		for _, v := range rawVals {
			if strings.HasPrefix(v, "*") {
				cleanVal := strings.TrimPrefix(v, "*")
				defVal = cleanVal
				values = append(values, cleanVal)
			} else {
				values = append(values, v)
			}
		}

		options = append(options, PPDOption{
			Name:    name,
			Label:   label,
			Default: defVal,
			Values:  values,
		})
	}
	return options
}
