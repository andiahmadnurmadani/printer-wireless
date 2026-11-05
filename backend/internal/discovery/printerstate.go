package discovery

import (
	"fmt"
	"net/url"
	"time"
)

// PrinterStateIPP reads printer-state-reasons and printer-is-accepting-jobs from
// cupsd. host is "host:port". Reasons exclude "none".
//
// ponytail: parseIPP drops additional values, so only the first reason is seen;
// enough for one active alert, extend parseIPP if multi-reason alerts matter.
func PrinterStateIPP(host, printerName string, timeout time.Duration) (reasons []string, accepting bool, err error) {
	path := "/printers/" + url.PathEscape(printerName)
	resp, err := ippPostBytes(host, path, ippBuild(0x000B, "ipp://localhost"+path, nil, 0, ""), timeout)
	if err != nil {
		return nil, false, err
	}
	if resp.Status >= 0x0400 {
		return nil, false, fmt.Errorf("ipp status 0x%04X for %s", resp.Status, printerName)
	}
	for _, r := range resp.Attributes["printer-state-reasons"] {
		if r != "" && r != "none" {
			reasons = append(reasons, r)
		}
	}
	acc := resp.Attributes["printer-is-accepting-jobs"]
	return reasons, len(acc) == 0 || acc[0] == "true", nil
}
