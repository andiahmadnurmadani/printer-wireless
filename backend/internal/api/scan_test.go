package api

import "testing"

func TestScanReqValidate(t *testing.T) {
	q := scanReq{}
	mode, err := q.validate()
	if err != nil || mode != "Color" || q.Resolution != 300 || q.SessionID == "" {
		t.Fatalf("defaults: mode=%q res=%d sess=%q err=%v", mode, q.Resolution, q.SessionID, err)
	}
	if m, _ := (&scanReq{Mode: "bw"}).validate(); m != "Lineart" {
		t.Fatalf("bw -> %q", m)
	}
	for _, bad := range []scanReq{
		{Resolution: 1200},
		{Mode: "sepia"},
		{SessionID: "../../etc"},
	} {
		if _, err := bad.validate(); err == nil {
			t.Fatalf("expected error for %+v", bad)
		}
	}
}
