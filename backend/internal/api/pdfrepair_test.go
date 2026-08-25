package api

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"kroomprint/backend/internal/store"
)

func writeTempPDF(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "doc.pdf")
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatalf("write temp pdf: %v", err)
	}
	return p
}

func TestPDFHasFloatRotate_DetectsFloatValue(t *testing.T) {
	p := writeTempPDF(t, "%PDF-1.4\n1 0 obj\n<< /Type /Page /Rotate 270.000061 >>\nendobj\n%%EOF\n")
	bad, err := pdfHasFloatRotate(p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !bad {
		t.Fatal("float /Rotate must be detected")
	}
}

func TestPDFHasFloatRotate_AcceptsIntegerValue(t *testing.T) {
	p := writeTempPDF(t, "%PDF-1.4\n1 0 obj\n<< /Type /Page /Rotate 270 >>\nendobj\n%%EOF\n")
	bad, err := pdfHasFloatRotate(p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if bad {
		t.Fatal("integer /Rotate must not be flagged")
	}
}

func TestRepairPDFWithGhostscript_SkipWhenGSMissing(t *testing.T) {
	if _, err := exec.LookPath("gs"); err != nil {
		t.Skip("ghostscript not installed on this host; repair runs on the CUPS host")
	}
}

func TestEstimatedPrintProgress_NeverReachesTerminal(t *testing.T) {
	j := store.Job{Pages: 24, Copies: 1, Quality: "Standard", CreatedAt: time.Now().Add(-time.Hour).UnixMilli()}
	for range 100 {
		if got := estimatedPrintProgress(&j); got >= 100 || got < 15 {
			t.Fatalf("progress %d outside cosmetic bounds [15,98]", got)
		}
	}
}

func TestLegacyStatusToOutcome_Mapping(t *testing.T) {
	cases := map[string]string{
		"printing":  "processing",
		"completed": "completed",
		"notfound":  "notfound",
		"weird":     "processing",
	}
	for in, want := range cases {
		if got := legacyStatusToOutcome(in); got != want {
			t.Fatalf("legacyStatusToOutcome(%q) = %q, want %q", in, got, want)
		}
	}
}
