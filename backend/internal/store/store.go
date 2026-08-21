package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Store wraps the SQLite database connection and all persistence logic.
type Store struct {
	db *sql.DB
}

// Open initializes the SQLite database at path, creating schema if needed.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// SQLite is fine with a single writer; keep pool small.
	db.SetMaxOpenConns(4)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS printers (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	brand TEXT,
	model TEXT,
	connection TEXT NOT NULL DEFAULT 'Network',
	address TEXT NOT NULL,
	mac TEXT,
	status TEXT NOT NULL DEFAULT 'online',
	enabled INTEGER NOT NULL DEFAULT 1,
	paused INTEGER NOT NULL DEFAULT 0,
	is_default INTEGER NOT NULL DEFAULT 0,
	toner INTEGER NOT NULL DEFAULT 100,
	paper INTEGER NOT NULL DEFAULT 250,
	speed TEXT,
	duplex INTEGER NOT NULL DEFAULT 0,
	color INTEGER NOT NULL DEFAULT 0,
	paper_sizes TEXT NOT NULL DEFAULT '[]',
	qualities TEXT NOT NULL DEFAULT '[]',
	scalings TEXT NOT NULL DEFAULT '[]',
	orientations TEXT NOT NULL DEFAULT '[]',
	added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	file_type TEXT NOT NULL,
	file_path TEXT,
	pages INTEGER NOT NULL DEFAULT 1,
	copies INTEGER NOT NULL DEFAULT 1,
	color INTEGER NOT NULL DEFAULT 0,
	duplex INTEGER NOT NULL DEFAULT 0,
	paper_size TEXT NOT NULL DEFAULT 'A4',
	orientation TEXT NOT NULL DEFAULT 'Portrait',
	quality TEXT NOT NULL DEFAULT 'Standard',
	scaling TEXT NOT NULL DEFAULT 'Fit to page',
	page_range TEXT,
	priority INTEGER NOT NULL DEFAULT 3,
	status TEXT NOT NULL DEFAULT 'queued',
	progress INTEGER NOT NULL DEFAULT 0,
	size TEXT,
	printer_id TEXT,
	cups_job_id INTEGER NOT NULL DEFAULT 0,
	error TEXT,
	created_at INTEGER NOT NULL,
	completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS history (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	file_type TEXT NOT NULL,
	pages INTEGER NOT NULL DEFAULT 1,
	copies INTEGER NOT NULL DEFAULT 1,
	printer_name TEXT,
	status TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	duration TEXT,
	error TEXT
);

CREATE TABLE IF NOT EXISTS discovered (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	brand TEXT,
	model TEXT,
	connection TEXT NOT NULL,
	address TEXT NOT NULL,
	mac TEXT,
	ip TEXT,
	caps JSON,
	first_seen INTEGER NOT NULL,
	is_virtual INTEGER NOT NULL DEFAULT 0,
	source TEXT NOT NULL DEFAULT 'ipp'
);

CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	// Lightweight migrations for DBs created before these columns existed.
	for _, col := range []string{"is_virtual", "source"} {
		var cnt int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM pragma_table_info('discovered') WHERE name = ?", col).Scan(&cnt); err == nil && cnt == 0 {
			def := "INTEGER NOT NULL DEFAULT 0"
			if col == "source" {
				def = "TEXT NOT NULL DEFAULT 'ipp'"
			}
			_, _ = s.db.Exec("ALTER TABLE discovered ADD COLUMN " + col + " " + def)
		}
	}
	for _, col := range []string{"cups_job_id", "error"} {
		var cnt int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM pragma_table_info('jobs') WHERE name = ?", col).Scan(&cnt); err == nil && cnt == 0 {
			def := "TEXT"
			if col == "cups_job_id" {
				def = "INTEGER NOT NULL DEFAULT 0"
			}
			_, _ = s.db.Exec("ALTER TABLE jobs ADD COLUMN " + col + " " + def)
		}
	}
	// Clean up any virtual / software printer artifacts in discovered
	_, _ = s.db.Exec(`DELETE FROM discovered WHERE is_virtual = 1 OR LOWER(name) LIKE '%rustdesk%' OR LOWER(name) LIKE '%onenote%' OR LOWER(name) LIKE '%pdf%'`)
	return nil
}

// ── JSON helpers for capability columns ──

func jsonArr(vals []string) string {
	b, _ := json.Marshal(vals)
	return string(b)
}

func parseArr(raw string) []string {
	out := make([]string, 0)
	if raw == "" {
		return out
	}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

// ── Time helpers ──

func nowMS() int64 { return time.Now().UnixMilli() }
