package discovery

import "testing"

type nameCase struct{ in, want string }

// TestPageSizeRoundTrip guards the catalogue against the exact class of bug
// found on 2026-09-24: PPD "8x10" was labelled "5x7 Photo" while the submission
// path mapped "5x7 Photo" back to "8x10", so the sheet that came out never
// matched the preview.
func TestPageSizeRoundTrip(t *testing.T) {
	// The Epson ESC/P-R PPD exposes 22 PageSize choices; the catalogue only ever
	// grows beyond that with panel-only aliases, so assert against the device
	// truth (see TestParseLpoptions) instead of a hardcoded catalogue length.
	if len(PageSizes) < 22 {
		t.Fatalf("catalogue size = %d, want at least the 22 PPD PageSize choices", len(PageSizes))
	}
	for _, ps := range PageSizes {
		if got := UINameForPPD(ps.PPD); got != ps.UI {
			t.Errorf("UINameForPPD(%q) = %q, want %q", ps.PPD, got, ps.UI)
		}
		if got := PPDNameForUI(ps.UI); got != ps.PPD {
			t.Errorf("PPDNameForUI(%q) = %q, want %q", ps.UI, got, ps.PPD)
		}
		if ps.MMW <= 0 || ps.MMH <= 0 {
			t.Errorf("%s: missing dimensions (%v x %v)", ps.PPD, ps.MMW, ps.MMH)
		}
	}
}

// TestPPDNameForUI covers the values the panel/database can send back,
// including labels stored by older versions.
func TestPPDNameForUI(t *testing.T) {
	cases := []nameCase{
		{"A4", "A4"},
		{"a4", "A4"},
		{"Letter", "Letter"},
		{"legal", "Legal"},
		{"4x6 Photo", "4X6FULL"},
		{"5x7 Photo", "2L"},
		{"2l", "2L"},
		{"4X6FULL", "4X6FULL"},
		{"Env DL", "EnvDL"},
		{"16K", "16K"},
		{"", ""},
		{"UNKNOWN-SIZE", "UNKNOWN-SIZE"},
	}
	for _, c := range cases {
		if got := PPDNameForUI(c.in); got != c.want {
			t.Errorf("PPDNameForUI(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestIPPMediaKeywords: CUPS only gets a media keyword when one exists; sizes
// without a standard IPP name rely on the PPD PageSize option alone.
func TestIPPMediaKeywords(t *testing.T) {
	cases := []nameCase{
		{"A4", "iso_a4_210x297mm"},
		{"Legal", "na_legal_8.5x14in"},
		{"5x7", "na_index-5x7_5x7in"},
		{"Env DL", "iso_dl_110x220mm"},
		{"4x7", ""},
	}
	for _, c := range cases {
		if got := IPPMediaForUI(c.in); got != c.want {
			t.Errorf("IPPMediaForUI(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestCleanMediaName covers the capability direction: what `lpoptions -p q -l`
// reports versus what the panel list must display.
func TestCleanMediaName(t *testing.T) {
	cases := []nameCase{
		{"A4", "A4"},
		{"*A5", "A5"},
		{"4X6FULL", "4x6"},
		{"T4X6FULL", "4x6 Borderless"},
		{"2L", "5x7"},
		{"8x10", "8x10"},
		{"INDEX5", "Index 5x8"},
		{"EnvDL", "Env DL"},
		{"WEIRD9x9", "WEIRD9x9"},
	}
	for _, c := range cases {
		if got := cleanMediaName(c.in); got != c.want {
			t.Errorf("cleanMediaName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
