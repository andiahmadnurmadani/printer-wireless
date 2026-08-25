package discovery

import (
	"bytes"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func appendIppTestValue(b []byte, tag byte, name, val string) []byte {
	var nameLen [2]byte
	binary.BigEndian.PutUint16(nameLen[:], uint16(len(name)))
	b = append(b, tag)
	b = append(b, nameLen[:]...)
	b = append(b, name...)
	var valLen [2]byte
	binary.BigEndian.PutUint16(valLen[:], uint16(len(val)))
	b = append(b, valLen[:]...)
	return append(b, val...)
}

func buildFakeJobAttributesResponse(status uint16, state int32, reasons string, withReasons bool) []byte {
	out := []byte{0x01, 0x01}
	var st [2]byte
	binary.BigEndian.PutUint16(st[:], status)
	out = append(out, st[:]...)
	var rid [4]byte
	binary.BigEndian.PutUint32(rid[:], 1)
	out = append(out, rid[:]...)

	out = append(out, 0x01) // operation attributes group
	out = appendIppTestValue(out, 0x47, "attributes-charset", "utf-8")
	out = appendIppTestValue(out, 0x48, "attributes-natural-language", "en")

	out = append(out, 0x02) // job attributes group
	raw := make([]byte, 4)
	binary.BigEndian.PutUint32(raw, uint32(state))
	out = appendIppTestValue(out, 0x23, "job-state", string(raw))
	if withReasons {
		out = appendIppTestValue(out, 0x44, "job-state-reasons", reasons)
	}
	out = append(out, 0x03)
	return out
}

func serveFakeCUPS(t *testing.T, resp []byte) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/ipp")
		_, _ = w.Write(resp)
	}))
	t.Cleanup(srv.Close)
	return srv.Listener.Addr().String()
}

func TestGetJobStateIPP_Completed(t *testing.T) {
	resp := buildFakeJobAttributesResponse(0x0000, JobStateCompleted, "job-completed-successfully", true)
	host := serveFakeCUPS(t, resp)

	state, reasons, err := GetJobStateIPP(host, "L3210-Series", 76, 5*time.Second)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state != "completed" {
		t.Fatalf("state = %q, want completed", state)
	}
	if reasons != "job-completed-successfully" {
		t.Fatalf("reasons = %q", reasons)
	}
}

func TestGetJobStateIPP_Aborted(t *testing.T) {
	resp := buildFakeJobAttributesResponse(0x0000, JobStateAborted, "aborted-by-system", true)
	host := serveFakeCUPS(t, resp)

	state, reasons, err := GetJobStateIPP(host, "L3210-Series", 73, 5*time.Second)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state != "aborted" {
		t.Fatalf("state = %q, want aborted", state)
	}
	if reasons != "aborted-by-system" {
		t.Fatalf("reasons = %q", reasons)
	}
}

func TestGetJobStateIPP_NotFound(t *testing.T) {
	resp := buildFakeJobAttributesResponse(0x0406, 0, "", false)
	host := serveFakeCUPS(t, resp)

	state, _, err := GetJobStateIPP(host, "L3210-Series", 9999, 5*time.Second)
	if err != nil {
		t.Fatalf("not-found must be nil error, got: %v", err)
	}
	if state != "notfound" {
		t.Fatalf("state = %q, want notfound", state)
	}
}

func TestDecodeIPPEnum(t *testing.T) {
	raw := string([]byte{0x00, 0x00, 0x00, 0x09})
	got, ok := decodeIPPEnum(raw)
	if !ok || got != JobStateCompleted {
		t.Fatalf("decodeIPPEnum(%v) = %d,%v", []byte(raw), got, ok)
	}
	if _, ok := decodeIPPEnum("ab"); ok {
		t.Fatal("short payload must not decode")
	}
}

func TestJobStateName(t *testing.T) {
	cases := map[int]string{
		JobStateAborted:   "aborted",
		JobStateCanceled:  "canceled",
		JobStateCompleted: "completed",
		42:                "unknown",
	}
	for in, want := range cases {
		if got := JobStateName(in); got != want {
			t.Fatalf("JobStateName(%d) = %q, want %q", in, got, want)
		}
	}
}

// realCupsdResponse76 is captured verbatim from cupsd 2.4.7 on the print
// host: Get-Job-Attributes for a finished job answering job-state=completed(9).
var realCupsdResponse76 = []byte{
	0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
	0x01,
	0x47, 0x00, 0x12, 'a', 't', 't', 'r', 'i', 'b', 'u', 't', 'e', 's', '-', 'c', 'h', 'a', 'r', 's', 'e', 't', 0x00, 0x05, 'u', 't', 'f', '-', '8',
	0x48, 0x00, 0x1b, 'a', 't', 't', 'r', 'i', 'b', 'u', 't', 'e', 's', '-', 'n', 'a', 't', 'u', 'r', 'a', 'l', '-', 'l', 'a', 'n', 'g', 'u', 'a', 'g', 'e', 0x00, 0x02, 'e', 'n',
	0x02,
	0x23, 0x00, 0x09, 'j', 'o', 'b', '-', 's', 't', 'a', 't', 'e', 0x00, 0x04, 0x00, 0x00, 0x00, 0x09,
	0x03,
}

func TestGetJobStateIPP_RealCupsdFixture_Completed(t *testing.T) {
	host := serveFakeCUPS(t, realCupsdResponse76)
	state, _, err := GetJobStateIPP(host, "L3210-Series", 76, 5*time.Second)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state != "completed" {
		t.Fatalf("state = %q, want completed", state)
	}
}

func TestIPPBuiltGetJobRequest_Structure(t *testing.T) {
	body := ippBuildGetJobAttributes("ipp://localhost/printers/L3210-Series", 74)
	if len(body) < 9 || body[0] != 0x01 || body[1] != 0x01 {
		t.Fatal("malformed header")
	}
	op := binary.BigEndian.Uint16(body[2:4])
	if op != 0x0009 {
		t.Fatalf("operation = 0x%04X, want 0x0009", op)
	}
	if !bytes.Contains(body, []byte("job-id")) {
		t.Fatal("request must carry job-id attribute")
	}
	if !bytes.Contains(body, []byte("job-state")) {
		t.Fatal("request must request job-state")
	}
	if body[len(body)-1] != 0x03 {
		t.Fatal("request must end with end-of-attributes tag")
	}
}
