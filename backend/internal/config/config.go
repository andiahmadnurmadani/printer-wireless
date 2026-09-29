package config

import (
	"os"
	"path/filepath"
)

// Config holds runtime configuration for the KroomPrint backend.
type Config struct {
	// Addr is the HTTP listen address (e.g. ":8080").
	Addr string

	// DBPath is the SQLite database file location.
	DBPath string

	// UploadsDir is where uploaded print documents are stored.
	UploadsDir string

	// AllowedOrigins is the CORS allowlist (comma separated).
	AllowedOrigins []string

	// CUPSURL, when set (e.g. http://localhost:631 or ssh://amba@100.90.80.85),
	// enables real CUPS/IPP capability detection on Linux.
	CUPSURL string

	// CUPSSSH is the SSH target (user@host) used to run CUPS commands remotely
	// when CUPSURL is ssh://user@host. When empty, uses the ssh:// part of CUPSURL.
	CUPSSSH string

	// DiscoveryDelayMS simulates the time a network scan takes.
	DiscoveryDelayMS int

	// DemoMode seeds fake printers/jobs and injects simulated activity.
	// Default false — production mode shows only real data.
	DemoMode bool
}

// Load builds a Config from environment variables with sane defaults.
func Load() *Config {
	cupsURL := os.Getenv("KROOM_CUPS_URL")
	cupsSSH := os.Getenv("KROOM_CUPS_SSH")
	if cupsURL == "" && cupsSSH == "" {
		cupsURL = "ssh://amba"
		cupsSSH = "amba"
	}
	c := &Config{
		Addr:             envOr("KROOM_ADDR", ":8080"),
		DBPath:           envOr("KROOM_DB", filepath.Join("data", "kroomprint.db")),
		UploadsDir:       envOr("KROOM_UPLOADS", "uploads"),
		CUPSURL:          cupsURL,
		CUPSSSH:          cupsSSH,
		DiscoveryDelayMS: 1200,
		DemoMode:         os.Getenv("KROOM_DEMO") == "1" || os.Getenv("KROOM_DEMO") == "true",
	}
	if v := os.Getenv("KROOM_ORIGINS"); v != "" {
		c.AllowedOrigins = splitComma(v)
	} else {
		c.AllowedOrigins = []string{"*", "http://localhost:5174", "http://127.0.0.1:5174", "http://localhost:5173", "http://127.0.0.1:5173"}
	}
	return c
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func splitComma(s string) []string {
	var out []string
	cur := ""
	for _, r := range s {
		if r == ',' {
			if cur != "" {
				out = append(out, cur)
			}
			cur = ""
			continue
		}
		cur += string(r)
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
