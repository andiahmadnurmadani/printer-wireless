package api

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestBuildGSPageList(t *testing.T) {
	if got := buildGSPageList("dummy.pdf", ""); got != "" {
		t.Errorf("expected empty for empty range, got %q", got)
	}
	if got := buildGSPageList("dummy.pdf", "all"); got != "" {
		t.Errorf("expected empty for all range, got %q", got)
	}
	if got := buildGSPageList("dummy.pdf", "1-3, 5"); got != "1-3,5" {
		t.Errorf("expected 1-3,5 for custom range, got %q", got)
	}
}

func TestApplyCollationAndCopies(t *testing.T) {
	gs, err := exec.LookPath("gs")
	if err != nil {
		t.Skip("gs not installed")
	}

	tmpDir := t.TempDir()
	src := filepath.Join(tmpDir, "test.pdf")

	// Generate 3-page PDF
	cmd := exec.Command(gs, "-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-sOutputFile="+src, "-c", `
/Helvetica findfont 30 scalefont setfont
100 500 moveto (PAGE 1) show showpage
100 500 moveto (PAGE 2) show showpage
100 500 moveto (PAGE 3) show showpage
`)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to generate test pdf: %v (%s)", err, string(out))
	}

	// Case 1: copies=2, collate=true
	outPDF, copies, _ := applyCollationAndCopies(src, 2, true, "", nil)
	if copies != 1 {
		t.Errorf("expected copies=1 after collation expansion, got %d", copies)
	}
	if outPDF == src {
		t.Errorf("expected new collated pdf, got src")
	}
	defer os.Remove(outPDF)

	// Check page count of collated PDF
	if infoCmd, err := exec.LookPath("pdfinfo"); err == nil {
		infoOut, _ := exec.Command(infoCmd, outPDF).Output()
		if !containsLine(string(infoOut), "Pages:           6") {
			t.Errorf("expected 6 pages in collated pdf, got:\n%s", string(infoOut))
		}
	}
}

func containsLine(haystack, needle string) bool {
	return filepath.Clean(haystack) != "" && needle != "" && len(haystack) >= len(needle) && (haystack == needle || (len(haystack) > len(needle) && (haystack[:len(needle)] == needle || haystack[len(haystack)-len(needle):] == needle || containsSubstring(haystack, needle))))
}

func containsSubstring(h, n string) bool {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return true
		}
	}
	return false
}
