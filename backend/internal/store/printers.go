package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Capabilities describes what a printer supports.
// The frontend renders dropdown options from these values only.
type Capabilities struct {
	PaperSizes   []string `json:"paperSizes"`
	Qualities    []string `json:"qualities"`
	Scalings     []string `json:"scalings"`
	Orientations []string `json:"orientations"`
	Duplex       bool     `json:"duplex"`
	Color        bool     `json:"color"`
	MaxCopies    int      `json:"maxCopies"`
}

// Printer is a registered printer.
type Printer struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Brand       string       `json:"brand"`
	Model       string       `json:"model"`
	Connection  string       `json:"connection"` // Network | WiFi | USB
	Address     string       `json:"address"`    // IP or USB port
	MAC         string       `json:"mac"`
	Status      string       `json:"status"` // online | offline | paused | error
	Enabled     bool         `json:"enabled"`
	Paused      bool         `json:"paused"`
	IsDefault   bool         `json:"isDefault"`
	Toner       int          `json:"toner"`
	Paper       int          `json:"paper"`
	Speed       string       `json:"speed"`
	Caps        Capabilities `json:"caps"`
	AddedAt     string       `json:"addedAt"`
	DiscoveredID string      `json:"-"` // internal: which discovered entry this came from
}

const printerCols = `id, name, brand, model, connection, address, mac, status, enabled, paused,
	is_default, toner, paper, speed, duplex, color, paper_sizes, qualities, scalings, orientations, added_at`

func scanPrinter(row interface{ Scan(...any) error }) (Printer, error) {
	var p Printer
	var enabled, paused, isDefault, duplex, color int
	var paperSizes, qualities, scalings, orientations string
	err := row.Scan(
		&p.ID, &p.Name, &p.Brand, &p.Model, &p.Connection, &p.Address, &p.MAC,
		&p.Status, &enabled, &paused, &isDefault, &p.Toner, &p.Paper, &p.Speed,
		&duplex, &color, &paperSizes, &qualities, &scalings, &orientations, &p.AddedAt,
	)
	if err != nil {
		return p, err
	}
	p.Enabled = enabled == 1
	p.Paused = paused == 1
	p.IsDefault = isDefault == 1
	p.Caps = Capabilities{
		PaperSizes:   parseArr(paperSizes),
		Qualities:    parseArr(qualities),
		Scalings:     parseArr(scalings),
		Orientations: parseArr(orientations),
		Duplex:       duplex == 1,
		Color:        color == 1,
		MaxCopies:    999,
	}
	return p, nil
}

func printerArgs(p Printer) []any {
	return []any{
		p.ID, p.Name, p.Brand, p.Model, p.Connection, p.Address, p.MAC, p.Status,
		boolInt(p.Enabled), boolInt(p.Paused), boolInt(p.IsDefault),
		p.Toner, p.Paper, p.Speed, boolInt(p.Caps.Duplex), boolInt(p.Caps.Color),
		jsonArr(p.Caps.PaperSizes), jsonArr(p.Caps.Qualities), jsonArr(p.Caps.Scalings), jsonArr(p.Caps.Orientations),
		p.AddedAt,
	}
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ── CRUD ──

func (s *Store) ListPrinters() ([]Printer, error) {
	rows, err := s.db.Query("SELECT " + printerCols + " FROM printers ORDER BY added_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// non-nil slice so JSON marshals to [] instead of null
	out := make([]Printer, 0)
	for rows.Next() {
		p, err := scanPrinter(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) GetPrinter(id string) (Printer, error) {
	row := s.db.QueryRow("SELECT "+printerCols+" FROM printers WHERE id = ?", id)
	return scanPrinter(row)
}

func (s *Store) CreatePrinter(p Printer) (Printer, error) {
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	if p.AddedAt == "" {
		p.AddedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if p.Status == "" {
		p.Status = "online"
	}
	if p.Enabled {
		// first printer added becomes default
		var cnt int
		_ = s.db.QueryRow("SELECT COUNT(*) FROM printers").Scan(&cnt)
		if cnt == 0 {
			p.IsDefault = true
		}
	}
	_, err := s.db.Exec(
		"INSERT INTO printers ("+printerCols+") VALUES ("+placeholders(21)+")",
		printerArgs(p)...,
	)
	if err != nil {
		return p, fmt.Errorf("insert printer: %w", err)
	}
	return p, nil
}

func (s *Store) UpdatePrinter(p Printer) error {
	_, err := s.db.Exec(`
		UPDATE printers SET name=?, brand=?, model=?, connection=?, address=?, mac=?, status=?,
			enabled=?, paused=?, is_default=?, toner=?, paper=?, speed=?,
			duplex=?, color=?, paper_sizes=?, qualities=?, scalings=?, orientations=?
		WHERE id=?`,
		p.Name, p.Brand, p.Model, p.Connection, p.Address, p.MAC, p.Status,
		boolInt(p.Enabled), boolInt(p.Paused), boolInt(p.IsDefault),
		p.Toner, p.Paper, p.Speed, boolInt(p.Caps.Duplex), boolInt(p.Caps.Color),
		jsonArr(p.Caps.PaperSizes), jsonArr(p.Caps.Qualities), jsonArr(p.Caps.Scalings), jsonArr(p.Caps.Orientations),
		p.ID,
	)
	return err
}

func (s *Store) DeletePrinter(id string) error {
	// re-assign jobs on this printer to none
	_, _ = s.db.Exec("UPDATE jobs SET printer_id = NULL WHERE printer_id = ?", id)
	_, err := s.db.Exec("DELETE FROM printers WHERE id = ?", id)
	return err
}

// ── Partial updates ──

func (s *Store) PatchPrinter(id string, fn func(*Printer) error) error {
	p, err := s.GetPrinter(id)
	if err != nil {
		return err
	}
	if err := fn(&p); err != nil {
		return err
	}
	return s.UpdatePrinter(p)
}

func (s *Store) SetDefaultPrinter(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("UPDATE printers SET is_default = 0"); err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE printers SET is_default = 1 WHERE id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

// SetPrinterStatusByName updates status by printer name (used by seed).
func (s *Store) SetPrinterStatusByName(name, status string) error {
	_, err := s.db.Exec("UPDATE printers SET status = ? WHERE name = ?", status, name)
	return err
}

// SetPrinterEnabledByName toggles enabled by name (used by seed).
func (s *Store) SetPrinterEnabledByName(name string, enabled bool) error {
	_, err := s.db.Exec("UPDATE printers SET enabled = ? WHERE name = ?", boolInt(enabled), name)
	return err
}

// EnsureDefaultPrinter marks the first enabled printer as default if none is set.
func (s *Store) EnsureDefaultPrinter() error {
	var cnt int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM printers WHERE is_default = 1").Scan(&cnt); err != nil {
		return err
	}
	if cnt > 0 {
		return nil
	}
	var id string
	err := s.db.QueryRow("SELECT id FROM printers WHERE enabled = 1 ORDER BY added_at ASC LIMIT 1").Scan(&id)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	return s.SetDefaultPrinter(id)
}

// ── Discovery store ──

// DiscoveredPrinter is a device found by a network scan, pending user approval.
type DiscoveredPrinter struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Brand      string       `json:"brand"`
	Model      string       `json:"model"`
	Connection string       `json:"connection"`
	Address    string       `json:"address"`
	MAC        string       `json:"mac"`
	IP         string       `json:"ip"`
	Caps       Capabilities `json:"caps"`
	FirstSeen  int64        `json:"firstSeen"`
	IsVirtual  bool         `json:"isVirtual"`
	Source     string       `json:"source"`
}

const discoveredCols = `id, name, brand, model, connection, address, mac, ip, caps, first_seen, is_virtual, source`

func (s *Store) SaveDiscovered(d DiscoveredPrinter) error {
	if d.ID == "" {
		d.ID = uuid.NewString()
	}
	if d.Source == "" {
		d.Source = "ipp"
	}
	capsJSON, _ := json.Marshal(d.Caps)
	_, err := s.db.Exec(`
		INSERT INTO discovered (id, name, brand, model, connection, address, mac, ip, caps, first_seen, is_virtual, source)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name, brand=excluded.brand, model=excluded.model,
			connection=excluded.connection, address=excluded.address, mac=excluded.mac,
			ip=excluded.ip, caps=excluded.caps, first_seen=excluded.first_seen,
			is_virtual=excluded.is_virtual, source=excluded.source`,
		d.ID, d.Name, d.Brand, d.Model, d.Connection, d.Address, d.MAC, d.IP, string(capsJSON), time.Now().UnixMilli(),
		boolInt(d.IsVirtual), d.Source,
	)
	return err
}

func scanDiscovered(row interface{ Scan(...any) error }) (DiscoveredPrinter, error) {
	var d DiscoveredPrinter
	var capsJSON string
	var isV int
	if err := row.Scan(&d.ID, &d.Name, &d.Brand, &d.Model, &d.Connection, &d.Address, &d.MAC, &d.IP, &capsJSON, &d.FirstSeen, &isV, &d.Source); err != nil {
		return d, err
	}
	_ = json.Unmarshal([]byte(capsJSON), &d.Caps)
	d.IsVirtual = isV == 1
	return d, nil
}

func (s *Store) ListDiscovered() ([]DiscoveredPrinter, error) {
	rows, err := s.db.Query("SELECT " + discoveredCols + " FROM discovered WHERE is_virtual = 0 AND LOWER(name) NOT LIKE '%rustdesk%' AND LOWER(name) NOT LIKE '%onenote%' AND LOWER(name) NOT LIKE '%pdf%' ORDER BY first_seen DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DiscoveredPrinter, 0)
	for rows.Next() {
		d, err := scanDiscovered(rows)
		if err != nil {
			return nil, err
		}
		// drop entries already registered
		var isReg int
		_ = s.db.QueryRow("SELECT COUNT(*) FROM printers WHERE address = ?", d.Address).Scan(&isReg)
		if isReg == 0 {
			out = append(out, d)
		}
	}
	return out, rows.Err()
}

func (s *Store) GetDiscovered(id string) (DiscoveredPrinter, error) {
	row := s.db.QueryRow("SELECT "+discoveredCols+" FROM discovered WHERE id = ?", id)
	return scanDiscovered(row)
}

func (s *Store) DeleteDiscovered(id string) error {
	_, err := s.db.Exec("DELETE FROM discovered WHERE id = ?", id)
	return err
}

// LooksLikePrinterID helps validation (id format "<brand>-<name>").
func LooksLikePrinterID(id string) bool {
	return strings.Contains(id, "-")
}
