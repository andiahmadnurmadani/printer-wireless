package discovery

import (
	"encoding/binary"
	"strings"
	"testing"
)

// attrValue returns the first attribute with the given name.
func attrValue(attrs []jobAttr, name string) (jobAttr, bool) {
	for _, a := range attrs {
		if a.name == name {
			return a, true
		}
	}
	return jobAttr{}, false
}

// attrValues returns every attribute with the given name (page-ranges repeats).
func attrValues(attrs []jobAttr, name string) []jobAttr {
	var out []jobAttr
	for _, a := range attrs {
		if a.name == name {
			out = append(out, a)
		}
	}
	return out
}

func hasAttr(attrs []jobAttr, name string) bool {
	_, ok := attrValue(attrs, name)
	return ok
}

// TestBuildJobAttrsFinishing covers the options that used to exist in the panel
// but were never sent on the IPP path (N-Up, page range, collate, tray).
func TestBuildJobAttrsFinishing(t *testing.T) {
	attrs := buildJobAttrs(JobOptions{
		Media:      "A4",
		Sides:      "one-sided",
		Copies:     3,
		ColorMode:  "grayscale",
		Quality:    "high",
		Scaling:    "Fit to page",
		MediaType:  "Plain Paper (Standard)",
		Orientation: "Portrait",
		NUp:        4,
		Collate:    true,
		PageRange:  "1-3,5",
		PageCount:  10,
	})

	if v, _ := attrValue(attrs, "PageSize"); v.str != "A4" {
		t.Errorf("PageSize = %q, want A4", v.str)
	}
	if v, _ := attrValue(attrs, "Ink"); v.str != "MONO" {
		t.Errorf("Ink = %q, want MONO", v.str)
	}
	if v, _ := attrValue(attrs, "MediaType"); v.str != "PLAIN_NORMAL" {
		t.Errorf("MediaType = %q, want PLAIN_NORMAL (label must be mapped)", v.str)
	}
	if hasAttr(attrs, "print-color-mode") {
		t.Error("print-color-mode must never be sent: it segfaults the Epson filter")
	}

	// N-Up must be an integer, not a keyword: CUPS ignores a keyword number-up.
	nu, ok := attrValue(attrs, "number-up")
	if !ok || nu.tag != 0x21 || nu.num != 4 {
		t.Errorf("number-up = %+v, want integer 4", nu)
	}
	if v, _ := attrValue(attrs, "number-up-layout"); v.str != "lrtb" {
		t.Errorf("number-up-layout = %q, want lrtb", v.str)
	}

	// Page ranges must be rangeOfInteger (0x33).
	ranges := attrValues(attrs, "page-ranges")
	if len(ranges) != 2 {
		t.Fatalf("page-ranges count = %d, want 2 (1-3 and 5)", len(ranges))
	}
	for _, r := range ranges {
		if r.tag != 0x33 {
			t.Errorf("page-ranges tag = %#x, want 0x33 rangeOfInteger", r.tag)
		}
	}
	if ranges[0].rng != [2]int32{1, 3} || ranges[1].rng != [2]int32{5, 5} {
		t.Errorf("page-ranges = %v, %v; want [1 3], [5 5]", ranges[0].rng, ranges[1].rng)
	}

	if v, _ := attrValue(attrs, "multiple-document-handling"); v.str != "separate-documents-collated-copies" {
		t.Errorf("multiple-document-handling = %q, want collated", v.str)
	}
	if v, _ := attrValue(attrs, "Collate"); v.str != "True" {
		t.Errorf("Collate = %q, want True", v.str)
	}
	if v, _ := attrValue(attrs, "print-quality"); v.num != 5 {
		t.Errorf("print-quality = %d, want 5 (high)", v.num)
	}
	if v, _ := attrValue(attrs, "orientation-requested"); v.num != 3 {
		t.Errorf("orientation-requested = %d, want 3 (portrait)", v.num)
	}
}

// TestBuildJobAttrsRejectsTrayLabels: the panel's tray list is display text and
// must never reach the filter chain.
func TestBuildJobAttrsRejectsTrayLabels(t *testing.T) {
	label := buildJobAttrs(JobOptions{Media: "A4", InputTray: "Main Cassette / Tray 1"})
	if hasAttr(label, "InputSlot") {
		t.Error("human tray label must not be sent as InputSlot")
	}

	keyword := buildJobAttrs(JobOptions{Media: "A4", InputTray: "TRAY1"})
	if v, ok := attrValue(keyword, "InputSlot"); !ok || v.str != "TRAY1" {
		t.Errorf("InputSlot = %+v, want TRAY1", v)
	}
}

// TestBuildJobAttrsManualDuplex: odd/even passes use page-set and never a page
// range (the two together would fight each other).
func TestBuildJobAttrsManualDuplex(t *testing.T) {
	attrs := buildJobAttrs(JobOptions{
		Media:        "A4",
		ManualDuplex: true,
		DuplexStep:   "even",
		PageRange:    "1-9",
	})
	if v, ok := attrValue(attrs, "page-set"); !ok || v.str != "even" {
		t.Errorf("page-set = %+v, want even", v)
	}
	if hasAttr(attrs, "page-ranges") {
		t.Error("manual duplex must not also send page-ranges")
	}
}

// TestBuildJobAttrsBorderlessPaper: "fill" on a photo size must switch to the
// printer's real borderless PPD entry (and not invent one).
func TestBuildJobAttrsBorderlessPaper(t *testing.T) {
	attrs := buildJobAttrs(JobOptions{Media: "4x6", Scaling: "Fill (Crop)"})
	if v, _ := attrValue(attrs, "PageSize"); v.str != "T4X6FULL" {
		t.Errorf("PageSize = %q, want T4X6FULL", v.str)
	}
	if hasAttr(attrs, "media") {
		t.Error("fill scaling must not also send an IPP media keyword")
	}

	// The installed PPD does expose TA4, so borderless A4 must use it.
	a4 := buildJobAttrs(JobOptions{Media: "A4", Borderless: true})
	if v, _ := attrValue(a4, "PageSize"); v.str != "TA4" {
		t.Errorf("PageSize = %q, want TA4 (borderless A4 exists on this PPD)", v.str)
	}

	// A6 has no borderless variant: the paper choice must stay untouched instead
	// of sending a made-up name that CUPS would silently drop.
	a6 := buildJobAttrs(JobOptions{Media: "A6", Borderless: true})
	if v, _ := attrValue(a6, "PageSize"); v.str != "A6" {
		t.Errorf("PageSize = %q, want A6 (no borderless variant exists)", v.str)
	}
}

func TestParsePageRanges(t *testing.T) {
	cases := []struct {
		sel       string
		pageCount int
		want      [][2]int32
	}{
		{"", 10, nil},
		{"all", 10, nil},
		{"1-3,5", 10, [][2]int32{{1, 3}, {5, 5}}},
		{" 1 , 4-6 ", 10, [][2]int32{{1, 1}, {4, 6}}},
		{"odd", 5, [][2]int32{{1, 1}, {3, 3}, {5, 5}}},
		{"even", 5, [][2]int32{{2, 2}, {4, 4}}},
		{"odd", 0, nil}, // no page count: cannot expand
		{"abc", 10, nil},
		{"9-3", 10, nil}, // reversed range is rejected
		{"0", 10, nil},
	}
	for _, c := range cases {
		got := parsePageRanges(c.sel, c.pageCount)
		if len(got) != len(c.want) {
			t.Errorf("parsePageRanges(%q, %d) = %v, want %v", c.sel, c.pageCount, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("parsePageRanges(%q, %d)[%d] = %v, want %v", c.sel, c.pageCount, i, got[i], c.want[i])
			}
		}
	}
}

func TestNormalizeInputSlotPPD(t *testing.T) {
	cases := []nameCase{
		{"", ""},
		{"Auto Select", ""},
		{"Main Cassette / Tray 1", ""},
		{"Rear Manual Feed Slot", ""},
		{"MP Tray (Multi-Purpose)", ""},
		{"TRAY1", "TRAY1"},
		{"MP_TRAY", "MP_TRAY"},
	}
	for _, c := range cases {
		if got := NormalizeInputSlotPPD(c.in); got != c.want {
			t.Errorf("NormalizeInputSlotPPD(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestBorderlessPPDName(t *testing.T) {
	cases := []nameCase{
		{"4x6", "T4X6FULL"},
		{"4x6 Borderless", "T4X6FULL"},
		{"4x7", "T4X7"},
		{"3.5x5", "TL"},
		{"Postcard", "TPostcard"},
		{"A4", "TA4"},                  // PPD has TA4 on the current driver
		{"A4 Borderless", "TA4"},
		{"Letter", "TLetter"},
		{"5x7", "T2L"},
		{"8x10", "T8x10"},
		{"A6", ""},     // no borderless variant exists for these
		{"Env DL", ""}, // ditto
		{"16K", ""},    // ditto
	}
	for _, c := range cases {
		if got := BorderlessPPDName(c.in); got != c.want {
			t.Errorf("BorderlessPPDName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestPDFTOPSPaper(t *testing.T) {
	cases := []nameCase{
		{"A4", "a4"},
		{"Letter", "letter"},
		{"Legal", "legal"},
		{"A5", "a5"},
		{"16K", "16k"},
		{"5x7", ""},    // pdftops does not know these: omit -paper
		{"Env DL", ""},
		{"4x6", ""},
	}
	for _, c := range cases {
		if got := PDFTOPSPaper(c.in); got != c.want {
			t.Errorf("PDFTOPSPaper(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestIPPJobAttributeEncoding checks the wire format: numeric options must carry
// their IPP syntax tag, otherwise CUPS silently ignores them.
// TestPPDSettingsArgs: operator PPD choices pass through as bare keywords, while
// the attributes KroomPrint owns (PageSize/Ink/MediaType/...) can never be
// overridden by a client payload.
func TestPPDSettingsArgs(t *testing.T) {
	args := PPDSettingsArgs(map[string]string{
		"Brightness": "25",
		"Contrast":   "-25",
		"Saturation": "0",
		"PageSize":   "A3",           // reserved: must be dropped
		"Ink":        "COLOR",        // reserved: must be dropped
		"MediaType":  "Plain Paper (Standard)", // reserved + label
		"Bad Option": "TRAY1",        // name with a space: not a PPD keyword
		"Junk":       "not a keyword", // value with spaces: rejected
	})
	want := [][2]string{{"Brightness", "25"}, {"Contrast", "-25"}, {"Saturation", "0"}}
	if len(args) != len(want) {
		t.Fatalf("PPDSettingsArgs = %v, want %v", args, want)
	}
	for i := range want {
		if args[i] != want[i] {
			t.Errorf("PPDSettingsArgs[%d] = %v, want %v", i, args[i], want[i])
		}
	}

	if !reservedJobOption("PageSize") || !reservedJobOption("ink") {
		t.Error("reservedJobOption must flag PageSize and ink (case-insensitive)")
	}
	if reservedJobOption("Brightness") {
		t.Error("Brightness is not a reserved option")
	}
}

// TestBuildJobAttrsPPDSettings: the passthrough also lands in the IPP attributes.
func TestBuildJobAttrsPPDSettings(t *testing.T) {
	attrs := buildJobAttrs(JobOptions{
		Media:       "A4",
		PPDSettings: map[string]string{"Brightness": "25", "PageSize": "A3"},
	})
	if v, ok := attrValue(attrs, "Brightness"); !ok || v.str != "25" {
		t.Errorf("Brightness = %+v, want keyword 25", v)
	}
	if v, _ := attrValue(attrs, "PageSize"); v.str != "A4" {
		t.Errorf("PageSize = %q, want A4 (client must not override the paper)", v.str)
	}
}

// TestParsePPDOptions covers the local PPD probe used by /api/printers/{id}/ppd-options.
func TestParsePPDOptions(t *testing.T) {
	opts := parsePPDOptions("Ink/Grayscale: *COLOR MONO\nBrightness/Brightness: -25 -24 *0 1 2 25\n\njunk line\n")
	if len(opts) != 2 {
		t.Fatalf("options = %d, want 2", len(opts))
	}
	if opts[0].Name != "Ink" || opts[0].Label != "Grayscale" || opts[0].Default != "COLOR" {
		t.Errorf("opts[0] = %+v", opts[0])
	}
	if opts[1].Name != "Brightness" || opts[1].Default != "0" || len(opts[1].Values) != 6 {
		t.Errorf("opts[1] = %+v (want default 0 and 6 values)", opts[1])
	}
}

// TestIsFillScaling covers the vocabulary the panel and the backend must agree
// on: the shared dropdown now sends "Fill page (Crop)" for both documents and
// photos, and every backend path must treat it as cover.
func TestIsFillScaling(t *testing.T) {
	cases := []struct {
		scaling    string
		borderless bool
		want       bool
	}{
		{"Fit to page", false, false},
		{"Shrink to fit", false, false},
		{"Actual size", false, false},
		{"Fill page (Crop)", false, true},
		{"fill (crop)", false, true},
		{"Fill", false, true},
		{"", false, false},
		{"", true, true},          // borderless implies cover
		{"Fit to page", true, true}, // ditto
	}
	for _, c := range cases {
		if got := IsFillScaling(c.scaling, c.borderless); got != c.want {
			t.Errorf("IsFillScaling(%q, %v) = %v, want %v", c.scaling, c.borderless, got, c.want)
		}
	}
}

func TestIPPJobAttributeEncoding(t *testing.T) {
	attrs := []jobAttr{
		jobKeyword("PageSize", "A4"),
		jobInt("number-up", 4),
		jobBool("fitplot", true),
		jobRange("page-ranges", 2, 5),
	}
	body := ippBuildPrintJob("ipp://localhost/printers/x", "application/pdf", "job", attrs, 3)

	// integer 0x21 "number-up" = 4
	if !containsTypedAttr(body, 0x21, "number-up", []byte{0, 0, 0, 4}) {
		t.Error("number-up not encoded as an integer 4")
	}
	// boolean 0x22 "fitplot" = 1
	if !containsTypedAttr(body, 0x22, "fitplot", []byte{0, 0, 0, 1}) {
		t.Error("fitplot not encoded as a boolean true")
	}
	// rangeOfInteger 0x33 "page-ranges" = [2,5]
	want := make([]byte, 8)
	binary.BigEndian.PutUint32(want[0:], 2)
	binary.BigEndian.PutUint32(want[4:], 5)
	if !containsTypedAttr(body, 0x33, "page-ranges", want) {
		t.Error("page-ranges not encoded as rangeOfInteger [2,5]")
	}
	// keyword 0x44 "PageSize" = A4
	if !containsTypedAttr(body, 0x44, "PageSize", []byte("A4")) {
		t.Error("PageSize not encoded as keyword A4")
	}
	// copies stays an integer
	if !containsTypedAttr(body, 0x21, "copies", []byte{0, 0, 0, 3}) {
		t.Error("copies not encoded as integer 3")
	}
}

// containsTypedAttr scans the encoded request for tag+name+valueLength+value.
func containsTypedAttr(body []byte, tag byte, name string, value []byte) bool {
	needle := make([]byte, 0, len(name)+len(value)+5)
	needle = append(needle, tag, 0, byte(len(name)))
	needle = append(needle, name...)
	needle = append(needle, 0, byte(len(value)))
	needle = append(needle, value...)
	return strings.Contains(string(body), string(needle))
}
