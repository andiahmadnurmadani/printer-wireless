package discovery

import "testing"

// lpoptionsFixture is the verbatim `lpoptions -p L3210-Series -l` output from the
// Epson L3210 on amba (2026-09-24). It captures the two traps that broke the
// capability probe: the MediaType line contains "media" (and must NOT be read as
// paper sizes), and the PPD exposes 22 PageSize choices.
const lpoptionsFixture = `MediaType/Print Quality: PLAIN_HIGH *PLAIN_NORMAL SFINE_HIGH SFINE_NORMAL PMMATT_HIGH PMMATT_NORMAL PLATINA_HIGH PLATINA_NORMAL PMPHOTO_HIGH PMPHOTO_NORMAL PMPHOTO_DRAFT PSGLOS_HIGH PSGLOS_NORMAL PSGLOS_DRAFT LCPP_HIGH LCPP_NORMAL LCPP_DRAFT ENV_HIGH ENV_NORMAL
Ink/Grayscale: *COLOR MONO
PageSize/Media Size: *A4 4X6FULL T4X6FULL 2L A6 A5 B5 B6 L TL INDEX5 8x10 4X7 T4X7 Postcard TPostcard ENV10 EnvDL ENVC6 Letter Legal 16K
Brightness/Brightness: -25 -24 *0 1 2 25
Contrast/Contrast: -25 *0 25
Saturation/Saturation: -25 *0 25
`

// ppdPageSizeUI is the panel order the parser produces for the L3210 PPD dump
// above (22 PageSize choices, ordered by the catalogue).
var ppdPageSizeUI = []string{
	"A4", "Letter", "A5", "Legal", "A6", "B5", "B6", "16K",
	"4x6", "4x6 Borderless", "5x7", "8x10", "4x7", "4x7 Borderless",
	"3.5x5", "3.5x5 Borderless", "Index 5x8", "Postcard", "Postcard Borderless",
	"Env #10", "Env DL", "Env C6",
}

func TestParseLpoptions(t *testing.T) {
	caps := baseCaps()
	parseLpoptions(lpoptionsFixture, caps)

	if len(caps.PaperSizes) != len(ppdPageSizeUI) {
		t.Fatalf("paper sizes = %d (%v), want %d", len(caps.PaperSizes), caps.PaperSizes, len(ppdPageSizeUI))
	}
	for i, want := range ppdPageSizeUI {
		if caps.PaperSizes[i] != want {
			t.Errorf("paper[%d] = %q, want %q", i, caps.PaperSizes[i], want)
		}
	}
	if !caps.Color {
		t.Error("Color = false, want true (PPD lists COLOR)")
	}
	if caps.Duplex {
		t.Error("Duplex = true, want false (L3210 has no duplex unit)")
	}
}

// TestParseLpoptionsIgnoresMediaType is the regression guard for the leaked
// MediaType values (PLAIN_NORMAL, PMPHOTO_HIGH, ...) that appeared as paper.
func TestParseLpoptionsIgnoresMediaType(t *testing.T) {
	caps := baseCaps()
	parseLpoptions(lpoptionsFixture, caps)

	for _, s := range caps.PaperSizes {
		if s == "PLAIN_NORMAL" || s == "PMPHOTO_HIGH" || s == "SFINE_NORMAL" {
			t.Fatalf("MediaType value %q leaked into the paper list: %v", s, caps.PaperSizes)
		}
	}
}
