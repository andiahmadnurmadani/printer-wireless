package discovery

import "strings"

// PageSize is one paper size exposed by the printer PPD.
//
// The catalogue below mirrors the Epson ESC/P-R PPD shipped with the L3210 /
// L3250 family (`lpoptions -p <queue> -l`, 22 PageSize choices) and is the
// single source of truth for both directions:
//
//	UINameForPPD  – PPD name → KroomPrint UI name (printer capability lists)
//	PPDNameForUI  – KroomPrint UI name → PPD name (media= / PageSize= options)
//
// Keeping both directions in one table is what prevents the 5x7↔8x10 class of
// bug: the old code mapped PPD "8x10" to the label "5x7 Photo" while the
// submission path mapped "5x7 Photo" back to PPD "8x10", so the paper that came
// out never matched the preview.
type PageSize struct {
	PPD  string  // PPD PageSize keyword
	UI   string  // display name used by the panel + preview
	MMW  float64 // width in millimetres
	MMH  float64 // height in millimetres
	IPP  string  // canonical IPP media keyword ("" when CUPS has no standard name)
}

// PageSizes is ordered the way a normal print dialog lists paper: common
// document sizes first, then photo, cards/postcard, then envelopes.
var PageSizes = []PageSize{
	{"A4", "A4", 210.0, 297.0, "iso_a4_210x297mm"},
	{"TA4", "A4 Borderless", 210.0, 297.0, "iso_a4_210x297mm"},
	{"Letter", "Letter", 215.9, 279.4, "na_letter_8.5x11in"},
	{"TLetter", "Letter Borderless", 215.9, 279.4, "na_letter_8.5x11in"},
	{"A5", "A5", 148.0, 210.0, "iso_a5_148x210mm"},
	{"Legal", "Legal", 215.9, 355.6, "na_legal_8.5x14in"},
	{"A6", "A6", 105.0, 148.0, "iso_a6_105x148mm"},
	{"B5", "B5", 182.0, 257.0, "jis_b5_182x257mm"},
	{"B6", "B6", 128.0, 182.0, "jis_b6_128x182mm"},
	{"16K", "16K", 195.0, 270.0, "roc16k_195x270mm"},
	{"4X6FULL", "4x6", 101.6, 152.4, "na_index-4x6_4x6in"},
	{"T4X6FULL", "4x6 Borderless", 101.6, 152.4, "na_index-4x6_4x6in"},
	{"2L", "5x7", 127.0, 178.0, "na_index-5x7_5x7in"},
	{"T2L", "5x7 Borderless", 127.0, 178.0, "na_index-5x7_5x7in"},
	{"8x10", "8x10", 203.2, 254.0, "na_govt-letter_8x10in"},
	{"T8x10", "8x10 Borderless", 203.2, 254.0, "na_govt-letter_8x10in"},
	{"4X7", "4x7", 101.6, 180.6, ""},
	{"T4X7", "4x7 Borderless", 101.6, 180.6, ""},
	{"L", "3.5x5", 89.0, 127.0, ""},
	{"TL", "3.5x5 Borderless", 89.0, 127.0, ""},
	{"INDEX5", "Index 5x8", 127.0, 203.2, "na_index-5x8_5x8in"},
	{"Postcard", "Postcard", 100.0, 148.0, "jpn_hagaki_100x148mm"},
	{"TPostcard", "Postcard Borderless", 100.0, 148.0, "jpn_hagaki_100x148mm"},
	{"ENV10", "Env #10", 104.8, 241.3, "na_number-10_4.125x9.5in"},
	{"EnvDL", "Env DL", 110.0, 220.0, "iso_dl_110x220mm"},
	{"ENVC6", "Env C6", 114.0, 162.0, "iso_c6_114x162mm"},
}

// borderlessVariants maps a PPD PageSize to the printer's full-bleed variant.
// Verified against the L3210 PPD currently installed on amba, which exposes 26
// PageSize choices: the eight "T"-prefixed borderless entries below (A4, Letter,
// 4x6, 5x7, 8x10, 4x7, 3.5x5, postcard) plus their normal counterparts. Sizes
// without a variant return "" so no bogus option is sent — the old table
// invented names and CUPS quietly fell back to its default paper while the panel
// still claimed borderless.
var borderlessVariants = map[string]string{
	"A4":        "TA4",
	"TA4":       "TA4",
	"Letter":    "TLetter",
	"TLetter":   "TLetter",
	"4X6FULL":   "T4X6FULL",
	"T4X6FULL":  "T4X6FULL",
	"2L":        "T2L",
	"T2L":       "T2L",
	"8x10":      "T8x10",
	"T8x10":     "T8x10",
	"4X7":       "T4X7",
	"T4X7":      "T4X7",
	"L":         "TL",
	"TL":        "TL",
	"Postcard":  "TPostcard",
	"TPostcard": "TPostcard",
}

// BorderlessPPDName maps a paper name to its full-bleed borderless PPD keyword,
// or "" when the printer has no borderless variant for that size.
func BorderlessPPDName(media string) string {
	if v, ok := borderlessVariants[PPDNameForUI(media)]; ok {
		return v
	}
	return ""
}

// IsFillScaling reports whether a scaling name means "cover" — fill the sheet and
// crop the overflow — as opposed to fit/contain. Centralised so the panel's list
// ("Fill page (Crop)") and every backend path agree, which is what keeps the
// preview and the printed sheet in sync.
func IsFillScaling(scaling string, borderless bool) bool {
	if borderless {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(scaling)) {
	case "fill", "fill page", "fill (crop)", "fill page (crop)", "cover", "crop":
		return true
	}
	return false
}

// PDFTOPSPaper maps a panel paper name to a paper name that poppler's pdftops
// knows (its -paper option only accepts a handful of standard names). Unknown
// sizes return "" so callers omit -paper and keep the document's own geometry;
// CUPS print-scaling then fits the content to the sheet the user selected.
func PDFTOPSPaper(media string) string {
	switch PPDNameForUI(media) {
	case "A4":
		return "a4"
	case "A5":
		return "a5"
	case "A6":
		return "a6"
	case "B5":
		return "b5"
	case "B6":
		return "b6"
	case "Letter":
		return "letter"
	case "Legal":
		return "legal"
	case "16K":
		return "16k"
	}
	return ""
}

// PPDNames lists every PPD PageSize keyword in catalogue order (used for the
// PPD introspection fallback).
func PPDNames() []string {
	out := make([]string, 0, len(PageSizes))
	for _, ps := range PageSizes {
		out = append(out, ps.PPD)
	}
	return out
}

// DefaultPageSize is the PPD default (A4).
const DefaultPageSize = "A4"

// legacyUINames keeps paper labels written by earlier panel versions working
// after the catalogue rename (photo sizes used to be labelled "4x6 Photo" /
// "5x7 Photo", and "5x7 Photo" used to be mapped to the wrong PPD size).
var legacyUINames = map[string]string{
	"4x6 photo": "4x6",
	"5x7 photo": "5x7",
}

// UINameForPPD maps a PPD PageSize keyword to the panel display name. Unknown
// names are returned unchanged so exotic PPD choices still show up (with an A4
// preview fallback) instead of silently disappearing.
func UINameForPPD(ppd string) string {
	key := strings.ToLower(strings.TrimSpace(ppd))
	if alias, ok := legacyUINames[key]; ok {
		return alias
	}
	for _, ps := range PageSizes {
		if strings.ToLower(ps.PPD) == key || strings.ToLower(ps.UI) == key {
			return ps.UI
		}
	}
	return strings.TrimSpace(ppd)
}

// PPDNameForUI maps a panel paper name (or an already valid PPD keyword) to the
// PPD PageSize keyword. Unknown values are passed through untouched so callers
// never lose information; sending an unknown size is harmless because CUPS
// falls back to the PPD default.
func PPDNameForUI(ui string) string {
	key := strings.ToLower(strings.TrimSpace(ui))
	if key == "" {
		return ""
	}
	if alias, ok := legacyUINames[key]; ok {
		key = alias
	}
	for _, ps := range PageSizes {
		if strings.ToLower(ps.UI) == key || strings.ToLower(ps.PPD) == key {
			return ps.PPD
		}
	}
	return strings.TrimSpace(ui)
}

// IPPMediaForUI maps a panel paper name to the canonical IPP media keyword.
// Returns "" when CUPS has no standard name (the PPD PageSize option alone then
// selects the paper, exactly like `lp -o PageSize=...`).
func IPPMediaForUI(ui string) string {
	key := strings.ToLower(strings.TrimSpace(ui))
	if key == "" {
		return ""
	}
	for _, ps := range PageSizes {
		if strings.ToLower(ps.UI) == key || strings.ToLower(ps.PPD) == key || strings.ToLower(ps.IPP) == key {
			return ps.IPP
		}
	}
	return ""
}

// PageSizeOptions returns the display labels (with dimensions) for the panel
// dropdown, in catalogue order.
func PageSizeOptions() []string {
	out := make([]string, 0, len(PageSizes))
	for _, ps := range PageSizes {
		out = append(out, ps.UI)
	}
	return out
}

// PageDimensionsPoints returns width and height in PostScript points (72 DPI)
// for ImageMagick/PDF generation to prevent invalid /PageSize [0 0] crashes in Ghostscript.
func PageDimensionsPoints(media string) (int, int) {
	key := strings.ToLower(strings.TrimSpace(media))
	for _, ps := range PageSizes {
		if strings.ToLower(ps.UI) == key || strings.ToLower(ps.PPD) == key || strings.ToLower(ps.IPP) == key {
			ptW := int(ps.MMW*72.0/25.4 + 0.5)
			ptH := int(ps.MMH*72.0/25.4 + 0.5)
			return ptW, ptH
		}
	}
	// Fallback to A4 (595 x 842 pt)
	return 595, 842
}

