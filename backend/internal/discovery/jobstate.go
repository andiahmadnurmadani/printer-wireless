package discovery

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// RFC 8011 job-state enum values returned by IPP Get-Job-Attributes.
const (
	JobStatePending    = 3
	JobStateHeld       = 4
	JobStateProcessing = 5
	JobStateStopped    = 6
	JobStateCanceled   = 7
	JobStateAborted    = 8
	JobStateCompleted  = 9
)

// jobStateNames maps IPP job-state enum values to human-readable names.
var jobStateNames = map[int]string{
	JobStatePending:    "pending",
	JobStateHeld:       "held",
	JobStateProcessing: "processing",
	JobStateStopped:    "stopped",
	JobStateCanceled:   "canceled",
	JobStateAborted:    "aborted",
	JobStateCompleted:  "completed",
}

// JobStateName converts an IPP job-state enum to its name ("unknown" if unrecognized).
func JobStateName(state int) string {
	if n, ok := jobStateNames[state]; ok {
		return n
	}
	return "unknown"
}

// decodeIPPEnum recovers an integer enum value stored by parseIPP as a raw
// 4-byte big-endian string.
func decodeIPPEnum(raw string) (int, bool) {
	b := []byte(raw)
	if len(b) != 4 {
		return 0, false
	}
	return int(binary.BigEndian.Uint32(b)), true
}

// ippBuildGetJobAttributes builds an IPP Get-Job-Attributes (0x0009) request
// targeting a specific job id on a printer URI.
func ippBuildGetJobAttributes(printerURI string, jobID int) []byte {
	var b bytes.Buffer
	b.Write([]byte{0x01, 0x01})                        // IPP/1.1
	binary.Write(&b, binary.BigEndian, uint16(0x0009)) // Get-Job-Attributes
	binary.Write(&b, binary.BigEndian, uint32(1))      // request-id

	// Operation attributes group
	b.WriteByte(0x01)
	writeIppAttr(&b, 0x47, "attributes-charset", "utf-8")
	writeIppAttr(&b, 0x48, "attributes-natural-language", "en")
	writeIppAttr(&b, 0x45, "printer-uri", printerURI)
	writeIppAttr(&b, 0x42, "requesting-user-name", "kroomprint")
	writeIppInt(&b, 0x21, "job-id", int32(jobID))
	writeIppAttr(&b, 0x44, "requested-attributes", "job-state,job-state-reasons")
	b.WriteByte(0x03) // end-of-attributes
	return b.Bytes()
}

// GetJobStateIPP queries the authoritative job-state of a CUPS job directly
// from cupsd over IPP/HTTP. Unlike `lpstat -W completed` (which lists aborted
// and canceled jobs alongside successful ones), this distinguishes:
//
//	completed(9) | aborted(8) | canceled(7) | stopped(6) | processing(5) | held(4) | pending(3)
//
// host is "host:port" (no scheme). Returns the state name, comma-joined
// job-state-reasons, or an error. A purged/unknown job yields state
// "notfound" with a nil error.
func GetJobStateIPP(host, printerName string, jobID int, timeout time.Duration) (string, string, error) {
	printerURI := "ipp://localhost/printers/" + url.PathEscape(printerName)
	// cupsd serves IPP on every resource; posting to the root path is required
	// for historical jobs — a per-printer path answers successful-ok with an
	// empty attribute group instead of the job attributes.
	body := ippBuildGetJobAttributes(printerURI, jobID)

	resp, err := ippPostBytes(host, "/", body, timeout)
	if err != nil {
		return "", "", fmt.Errorf("ipp get-job-attributes %s/%d: %w", printerName, jobID, err)
	}
	if resp.Status == 0x0406 {
		// client-error-not-found: job purged from CUPS history.
		return "notfound", "", nil
	}
	if resp.Status >= 0x0400 && resp.Status <= 0x04FF {
		return "", "", fmt.Errorf("ipp client-error 0x%04X for job %d", resp.Status, jobID)
	}
	if resp.Status >= 0x0500 {
		return "", "", fmt.Errorf("ipp server-error 0x%04X for job %d", resp.Status, jobID)
	}

	rawStates := resp.Attributes["job-state"]
	if len(rawStates) == 0 {
		return "", "", fmt.Errorf("ipp response missing job-state for job %d", jobID)
	}
	stateInt, ok := decodeIPPEnum(rawStates[0])
	if !ok {
		return "", "", fmt.Errorf("ipp job-state malformed for job %d", jobID)
	}
	reasons := joinNonEmpty(resp.Attributes["job-state-reasons"])
	return JobStateName(stateInt), reasons, nil
}

// joinNonEmpty joins string slices with ", " skipping empties.
func joinNonEmpty(vals []string) string {
	clean := make([]string, 0, len(vals))
	for _, v := range vals {
		v = strings.TrimSpace(v)
		if v != "" && v != "none" {
			clean = append(clean, v)
		}
	}
	return strings.Join(clean, ", ")
}
