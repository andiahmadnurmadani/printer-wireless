package api

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kroomprint/backend/internal/store"
)

// TestResolveOrientationForPDF_* pin the "no double rotation" rule that used to
// live inline in the dispatch path. It only fires for an already-landscape page.
func TestResolveOrientationForPDF_DropsLandscapeWhenPageAlreadyWide(t *testing.T) {
	if got := resolveOrientationForPDF("landscape", 842, 595); got != "portrait" {
		t.Fatalf("already-wide page must not be rotated again, got %q", got)
	}
}

func TestResolveOrientationForPDF_KeepsLandscapeForPortraitPage(t *testing.T) {
	if got := resolveOrientationForPDF("landscape", 595, 842); got != "landscape" {
		t.Fatalf("portrait page requested as landscape must stay landscape, got %q", got)
	}
}

func TestResolveOrientationForPDF_PassesThroughPortrait(t *testing.T) {
	if got := resolveOrientationForPDF("portrait", 842, 595); got != "portrait" {
		t.Fatalf("portrait request must pass through untouched, got %q", got)
	}
}

// TestEnsurePrintablePDF_PreservesPageGeometry is the regression guard for the
// reported bug: a PDF uploaded by the user was silently baked to A4 (and its
// content expanded to fill A4) before any paper was chosen, so every job came
// out A4 no matter what the user picked. ensurePrintablePDF must repair
// structure WITHOUT changing the page size.
//
// Skipped when ghostscript (or a geometry reader) is absent: the repair is a
// no-op there, and the CUPS host is where it actually runs.
func TestEnsurePrintablePDF_PreservesPageGeometry(t *testing.T) {
	gs, err := exec.LookPath("gs")
	if err != nil {
		t.Skip("ghostscript not installed on this host; repair runs on the CUPS host")
	}

	// Build a valid A5-sized PDF (419.53 x 595.28 pt). A bake to A4 would make
	// the width ~595 pt, which this test would catch.
	dir := t.TempDir()
	src := filepath.Join(dir, "a5.pdf")
	mk := exec.Command(gs,
		"-q", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
		"-dDEVICEWIDTHPOINTS=419.53", "-dDEVICEHEIGHTPOINTS=595.28",
		"-sOutputFile="+src, "-c", "showpage",
	)
	if out, err := mk.CombinedOutput(); err != nil {
		t.Skipf("cannot build test PDF with gs (%v): %s", err, strings.TrimSpace(string(out)))
	}

	before, _, ok := pageDimensionsPoints(src)
	if !ok {
		t.Skip("no PDF geometry reader (pdfinfo/identify) available on this host")
	}

	out := ensurePrintablePDF(src, nil)
	defer func() {
		if out != src {
			_ = os.Remove(out)
		}
	}()

	after, _, ok := pageDimensionsPoints(out)
	if !ok {
		t.Fatalf("cannot read page size of repaired PDF %s", out)
	}

	// A bake to A4 would report ~595 pt width. Allow 2 pt of rounding slack.
	if diff := after - before; diff > 2 || diff < -2 {
		t.Fatalf("page width changed from %d to %d pt: ensurePrintablePDF must not resize the document", before, after)
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

func TestFormatPDFForPrint_LandscapeAndScale(t *testing.T) {
	gs, err := exec.LookPath("gs")
	if err != nil {
		t.Skip("ghostscript not installed on this host; test runs on the CUPS host")
	}

	dir := t.TempDir()
	src := filepath.Join(dir, "cert.pdf")
	// Make a landscape PDF (842 x 595)
	mk := exec.Command(gs,
		"-q", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
		"-dDEVICEWIDTHPOINTS=842", "-dDEVICEHEIGHTPOINTS=595",
		"-sOutputFile="+src, "-c", "showpage",
	)
	if out, err := mk.CombinedOutput(); err != nil {
		t.Skipf("cannot build test PDF with gs (%v): %s", err, strings.TrimSpace(string(out)))
	}

	// Format for Landscape A4 with custom scale 50%
	formatted := formatPDFForPrint(src, nil, "A4", "Landscape", "Custom", 50, 0, false)
	defer func() {
		if formatted != src {
			_ = os.Remove(formatted)
		}
	}()

	w, h, ok := pageDimensionsPoints(formatted)
	if !ok {
		t.Fatalf("cannot read page dimensions of formatted PDF %s", formatted)
	}

	// Must match physical portrait feed dimensions for A4 (595 x 842 pt)
	if w != 595 || h != 842 {
		t.Fatalf("formatted PDF dimensions = %dx%d, want 595x842 (physical portrait feed)", w, h)
	}
}

