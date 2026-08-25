package api

import "testing"

func TestFileExtType_KnownFormats(t *testing.T) {
	cases := map[string]string{
		"report.PDF":     "PDF",
		"photo.jpg":      "JPG",
		"photo.jpeg":     "JPG",
		"screenshot.png": "PNG",
		"anim.webp":      "WEBP",
		"scan.bmp":       "BMP",
		"chart.gif":      "GIF",
		"fax.tif":        "TIFF",
		"fax.tiff":       "TIFF",
		"iphone.heic":    "HEIC",
		"logo.svg":       "SVG",
		"notes.txt":      "TXT",
		"data.csv":       "CSV",
		"laporan.doc":    "DOCX",
		"laporan.docx":   "DOCX",
		"budget.xls":     "XLSX",
		"budget.xlsx":    "XLSX",
		"deck.ppt":       "PPTX",
		"deck.pptx":      "PPTX",
		"surat.odt":      "ODT",
		"slide.odp":      "ODP",
		"tabel.ods":      "ODS",
		"manual.rtf":     "RTF",
		"page.html":      "HTML",
		"page.htm":       "HTML",
		".pdf":           "PDF",
	}
	for in, want := range cases {
		if got := fileExtType(in); got != want {
			t.Errorf("fileExtType(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFileExtType_UnknownIsEmpty(t *testing.T) {
	for _, in := range []string{"archive.zip", "song.mp3", "noext", ".exe"} {
		if got := fileExtType(in); got != "" {
			t.Errorf("fileExtType(%q) = %q, want empty", in, got)
		}
	}
}

func TestMimeForFile_NewFormats(t *testing.T) {
	cases := map[string]string{
		"a.gif":  "image/gif",
		"a.bmp":  "image/bmp",
		"a.tiff": "image/tiff",
		"a.tif":  "image/tiff",
		"a.webp": "image/webp",
		"a.heic": "image/heic",
		"a.svg":  "image/svg+xml",
		"a.odt":  "application/vnd.oasis.opendocument.text",
		"a.odp":  "application/vnd.oasis.opendocument.presentation",
	}
	for in, want := range cases {
		if got := mimeForFile(in); got != want {
			t.Errorf("mimeForFile(%q) = %q, want %q", in, got, want)
		}
	}
}
