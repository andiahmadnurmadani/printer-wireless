package discovery

import "strings"

// mediaTypeLabels maps the human-readable Media Type labels used by the
// KroomPrint UI to PPD-native MediaType keywords.
//
// The Epson ESC/P-R filter resolves MediaType through a PPD lookup table and
// dereferences the result without a nil check. Feeding it a label such as
// "Plain Paper (Standard)" (spaces + parentheses) makes it segfault, after
// which CUPS reports "Sent 0 bytes" but still marks the job as completed
// (verified live on 2026-09-24, job 193 on amba).
var mediaTypeLabels = map[string]string{
	"plain paper (standard)":         "PLAIN_NORMAL",
	"plain paper (normal)":           "PLAIN_NORMAL",
	"plain paper (high quality)":     "PLAIN_HIGH",
	"premium glossy photo paper":     "PMPHOTO_HIGH",
	"matte paper (heavyweight)":      "PMMATT_NORMAL",
	"photo quality inkjet paper":     "SFINE_NORMAL",
	"photo quality glossy paper":     "PSGLOS_NORMAL",
	"envelope (dl/c6/no.10)":         "ENV_NORMAL",
	"envelope (dl/c6)":               "ENV_NORMAL",
	"envelope (no.10)":               "ENV_NORMAL",
	"sticker / adhesive label":       "LCPP_NORMAL",
	"sticker / label":                "LCPP_NORMAL",
	"sticker":                        "LCPP_NORMAL",
}

// ppdMediaTypeKeywords is the set of MediaType choices exposed by the Epson
// ESC/P-R PPD family (see `lpoptions -p <queue> -l`). Anything outside this set
// must never be sent to the filter chain.
var ppdMediaTypeKeywords = map[string]bool{
	"PLAIN_NORMAL": true, "PLAIN_HIGH": true,
	"SFINE_NORMAL": true, "SFINE_HIGH": true,
	"PMMATT_NORMAL": true, "PMMATT_HIGH": true,
	"PLATINA_NORMAL": true, "PLATINA_HIGH": true,
	"PMPHOTO_NORMAL": true, "PMPHOTO_HIGH": true, "PMPHOTO_DRAFT": true,
	"PSGLOS_NORMAL": true, "PSGLOS_HIGH": true, "PSGLOS_DRAFT": true,
	"LCPP_NORMAL": true, "LCPP_HIGH": true, "LCPP_DRAFT": true,
	"ENV_NORMAL": true, "ENV_HIGH": true,
}

// NormalizeMediaTypePPD converts a UI media-type label (or an already valid PPD
// keyword) into the PPD-native MediaType keyword. It returns "" when the value
// is not recognised, so callers must omit the option instead of forwarding an
// invalid string into the CUPS filter chain.
func NormalizeMediaTypePPD(v string) string {
	key := strings.ToLower(strings.TrimSpace(v))
	if key == "" {
		return ""
	}
	if kw, ok := mediaTypeLabels[key]; ok {
		return kw
	}
	upper := strings.ToUpper(strings.TrimSpace(v))
	if ppdMediaTypeKeywords[upper] {
		return upper
	}
	return ""
}
