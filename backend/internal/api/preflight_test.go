package api

import "testing"

func TestAlertMessage(t *testing.T) {
	if m := alertMessage(nil); m != "" {
		t.Fatalf("no reasons -> %q", m)
	}
	if m := alertMessage([]string{"media-empty-error"}); m != "Kertas habis, isi baki kertas" {
		t.Fatalf("media-empty-error -> %q", m)
	}
	if !hasAlert([]string{"cover-open-warning"}, "door-open", "cover-open") {
		t.Fatal("cover-open not detected")
	}
	if hasAlert([]string{"connecting-to-device"}, "media-jam") {
		t.Fatal("false positive")
	}
	if s := usbSerial("usb://EPSON/L3210%20Series?serial=583848533035373513&interface=1"); s != "583848533035373513" {
		t.Fatalf("usbSerial -> %q", s)
	}
	if s := usbSerial("ipp://10.0.0.5/ipp/print"); s != "" {
		t.Fatalf("non-usb -> %q", s)
	}
}
