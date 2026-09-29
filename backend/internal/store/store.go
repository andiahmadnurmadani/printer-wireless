package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// QueryTimeout bounds a single database read. With SetMaxOpenConns(1) a wedged
// query holds the only pooled connection, so any read left unbounded can park
// the entire API (all goroutines end up in database/sql.(*DB).conn — observed
// live on 2026-09-24 on amba).
const QueryTimeout = 10 * time.Second

// WithQueryTimeout derives a context bounded by QueryTimeout, or by the
// parent's own earlier deadline when it is shorter.
func WithQueryTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	if parent == nil {
		parent = context.Background()
	}
	if dl, ok := parent.Deadline(); ok && time.Until(dl) < QueryTimeout {
		return context.WithCancel(parent)
	}
	return context.WithTimeout(parent, QueryTimeout)
}

// Store wraps the SQLite database connection and all persistence logic.
type Store struct {
	db *sql.DB
}

// Open initializes the SQLite database at path, creating schema if needed.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// SQLite is single-connection friendly; setting to 1 eliminates busy lock contention.
	db.SetMaxOpenConns(1)
	// Fail fast when a PRAGMA cannot be applied: silently running without WAL
	// (or without busy_timeout) re-opens the door to lock contention and to
	// unrecoverable mmap faults (SIGBUS) on stale WAL files (see 2026-09-04).
	pragma := func(stmt string) error {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("pragma %q: %w", stmt, err)
		}
		return nil
	}
	if err := pragma("PRAGMA journal_mode = WAL;"); err != nil {
		return nil, err
	}
	if err := pragma("PRAGMA busy_timeout = 5000;"); err != nil {
		return nil, err
	}
	if err := pragma("PRAGMA foreign_keys = ON;"); err != nil {
		return nil, err
	}
	if err := pragma("PRAGMA synchronous = NORMAL;"); err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	// Consolidate any WAL left behind by an unclean shutdown (a stale
	// -wal/-shm from a crashed process faulted the driver on 2026-08-26)
	// and refuse to serve traffic when the database image itself is corrupt.
	if _, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE);"); err != nil {
		return nil, fmt.Errorf("wal checkpoint: %w", err)
	}
	var integrity string
	if err := db.QueryRow("PRAGMA integrity_check;").Scan(&integrity); err != nil {
		return nil, fmt.Errorf("integrity check: %w", err)
	}
	if integrity != "ok" {
		return nil, fmt.Errorf("integrity check failed: %s", integrity)
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

CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'user',
	created_at INTEGER NOT NULL
);
`
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	if err := s.seedDefaultAdmin(); err != nil {
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
	for _, col := range []string{"cups_job_id", "error", "pin", "secure_release", "cost", "user", "department"} {
		var cnt int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM pragma_table_info('jobs') WHERE name = ?", col).Scan(&cnt); err == nil && cnt == 0 {
			def := "TEXT"
			switch col {
			case "cups_job_id", "secure_release", "cost":
				def = "INTEGER NOT NULL DEFAULT 0"
			case "user":
				def = "TEXT NOT NULL DEFAULT 'Andi Ahmad'"
			case "department":
				def = "TEXT NOT NULL DEFAULT 'Engineering'"
			}
			_, _ = s.db.Exec("ALTER TABLE jobs ADD COLUMN " + col + " " + def)
		}
	}
	for _, col := range []string{"cost", "user", "department"} {
		var cnt int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM pragma_table_info('history') WHERE name = ?", col).Scan(&cnt); err == nil && cnt == 0 {
			def := "TEXT"
			switch col {
			case "cost":
				def = "INTEGER NOT NULL DEFAULT 0"
			case "user":
				def = "TEXT NOT NULL DEFAULT 'Andi Ahmad'"
			case "department":
				def = "TEXT NOT NULL DEFAULT 'Engineering'"
			}
			_, _ = s.db.Exec("ALTER TABLE history ADD COLUMN " + col + " " + def)
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
