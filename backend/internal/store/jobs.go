package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Job is a print job in the queue.
type Job struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	FileType      string `json:"fileType"`
	FilePath      string `json:"-"`
	Pages         int    `json:"pages"`
	Copies        int    `json:"copies"`
	Color         bool   `json:"color"`
	Duplex        bool   `json:"duplex"`
	PaperSize     string `json:"paperSize"`
	Orientation   string `json:"orientation"`
	Quality       string `json:"quality"`
	Scaling       string `json:"scaling"`
	PageRange     string `json:"pageRange"`
	Priority      int    `json:"priority"`
	Status        string `json:"status"` // queued | printing | paused | completed | failed | cancelled | held-secure
	Progress      int    `json:"progress"`
	Size          string `json:"size"`
	PrinterID     string `json:"printerId"`
	CupsJobID     int    `json:"cupsJobId,omitempty"`
	Error         string `json:"error,omitempty"`
	CreatedAt     int64  `json:"createdAt"`
	CompletedAt   *int64 `json:"completedAt"`
	PIN           string `json:"pin,omitempty"`
	SecureRelease bool   `json:"secureRelease"`
	Cost          int    `json:"cost"`
	User          string `json:"user,omitempty"`
	Department    string `json:"department,omitempty"`
}

const jobCols = `id, name, file_type, file_path, pages, copies, color, duplex, paper_size,
	orientation, quality, scaling, page_range, priority, status, progress, size, printer_id,
	cups_job_id, error, created_at, completed_at, pin, secure_release, cost, user, department`

func scanJob(row interface{ Scan(...any) error }) (Job, error) {
	var j Job
	var color, duplex, cupsJobID, secureRelease, cost int
	var filePath, pageRange, size, printerID, errMsg, pin, user, department sql.NullString
	var completedAt sql.NullInt64
	err := row.Scan(
		&j.ID, &j.Name, &j.FileType, &filePath, &j.Pages, &j.Copies, &color, &duplex,
		&j.PaperSize, &j.Orientation, &j.Quality, &j.Scaling, &pageRange, &j.Priority,
		&j.Status, &j.Progress, &size, &printerID, &cupsJobID, &errMsg, &j.CreatedAt, &completedAt,
		&pin, &secureRelease, &cost, &user, &department,
	)
	if err != nil {
		return j, err
	}
	j.Color = color == 1
	j.Duplex = duplex == 1
	j.FilePath = filePath.String
	j.PageRange = pageRange.String
	j.Size = size.String
	j.CupsJobID = cupsJobID
	j.Error = errMsg.String
	j.PIN = pin.String
	j.SecureRelease = secureRelease == 1
	j.Cost = cost
	j.User = user.String
	if j.User == "" {
		j.User = "Andi Ahmad"
	}
	j.Department = department.String
	if j.Department == "" {
		j.Department = "Engineering"
	}
	if printerID.Valid {
		j.PrinterID = printerID.String
	}
	if completedAt.Valid {
		v := completedAt.Int64
		j.CompletedAt = &v
	}
	return j, nil
}

func jobArgs(j Job) []any {
	user := j.User
	if user == "" {
		user = "Andi Ahmad"
	}
	dept := j.Department
	if dept == "" {
		dept = "Engineering"
	}
	return []any{
		j.ID, j.Name, j.FileType, j.FilePath, j.Pages, j.Copies, boolInt(j.Color), boolInt(j.Duplex),
		j.PaperSize, j.Orientation, j.Quality, j.Scaling, j.PageRange, j.Priority,
		j.Status, j.Progress, j.Size, j.PrinterID, j.CupsJobID, j.Error, j.CreatedAt, j.CompletedAt,
		j.PIN, boolInt(j.SecureRelease), j.Cost, user, dept,
	}
}

func placeholders(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		if i > 0 {
			s += ", "
		}
		s += "?"
	}
	return s
}

// ── Jobs CRUD ──

func (s *Store) ListJobs() ([]Job, error) {
	rows, err := s.db.Query("SELECT " + jobCols + " FROM jobs ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// non-nil slice so JSON marshals to [] instead of null
	out := make([]Job, 0)
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

func (s *Store) GetJob(id string) (Job, error) {
	row := s.db.QueryRow("SELECT "+jobCols+" FROM jobs WHERE id = ?", id)
	return scanJob(row)
}

func (s *Store) CreateJob(j Job) (Job, error) {
	if j.ID == "" {
		j.ID = uuid.NewString()
	}
	if j.CreatedAt == 0 {
		j.CreatedAt = time.Now().UnixMilli()
	}
	if j.Status == "" {
		j.Status = "queued"
	}
	if j.Priority == 0 {
		j.Priority = 3
	}
	_, err := s.db.Exec("INSERT INTO jobs ("+jobCols+") VALUES ("+placeholders(27)+")", jobArgs(j)...)
	if err != nil {
		return j, fmt.Errorf("insert job: %w", err)
	}
	return j, nil
}

func (s *Store) UpdateJob(j Job) error {
	user := j.User
	if user == "" {
		user = "Andi Ahmad"
	}
	dept := j.Department
	if dept == "" {
		dept = "Engineering"
	}
	_, err := s.db.Exec(`
		UPDATE jobs SET name=?, file_type=?, file_path=?, pages=?, copies=?, color=?, duplex=?,
			paper_size=?, orientation=?, quality=?, scaling=?, page_range=?, priority=?,
			status=?, progress=?, size=?, printer_id=?, cups_job_id=?, error=?, created_at=?, completed_at=?,
			pin=?, secure_release=?, cost=?, user=?, department=?
		WHERE id=?`,
		j.Name, j.FileType, j.FilePath, j.Pages, j.Copies, boolInt(j.Color), boolInt(j.Duplex),
		j.PaperSize, j.Orientation, j.Quality, j.Scaling, j.PageRange, j.Priority,
		j.Status, j.Progress, j.Size, j.PrinterID, j.CupsJobID, j.Error, j.CreatedAt, j.CompletedAt,
		j.PIN, boolInt(j.SecureRelease), j.Cost, user, dept, j.ID,
	)
	return err
}

// PatchJobStatus updates only the status column.
func (s *Store) PatchJobStatus(id, status string) error {
	res, err := s.db.Exec("UPDATE jobs SET status = ? WHERE id = ?", status, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("job %s not found", id)
	}
	return nil
}

// PatchJobPriority updates only the priority column.
func (s *Store) PatchJobPriority(id string, priority int) error {
	res, err := s.db.Exec("UPDATE jobs SET priority = ? WHERE id = ?", priority, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("job %s not found", id)
	}
	return nil
}

// CancelAllActiveJobs marks all queued, printing, and paused jobs as cancelled.
func (s *Store) CancelAllActiveJobs() error {
	_, err := s.db.Exec("UPDATE jobs SET status = 'cancelled', progress = 0 WHERE status IN ('queued', 'printing', 'paused')")
	return err
}

// DeleteJob deletes a single job from the queue.
func (s *Store) DeleteJob(id string) error {
	_, err := s.db.Exec("DELETE FROM jobs WHERE id = ?", id)
	return err
}

// ClearJobs deletes all jobs from the queue table.
func (s *Store) ClearJobs() error {
	_, err := s.db.Exec("DELETE FROM jobs")
	return err
}

// ── History ──

type HistoryRecord struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	FileType    string `json:"fileType"`
	Pages       int    `json:"pages"`
	Copies      int    `json:"copies"`
	PrinterName string `json:"printerName"`
	Status      string `json:"status"`
	CreatedAt   int64  `json:"createdAt"`
	Duration    string `json:"duration"`
	Error       string `json:"error,omitempty"`
	Cost        int    `json:"cost"`
	User        string `json:"user,omitempty"`
	Department  string `json:"department,omitempty"`
}

func (s *Store) ListHistory(limit int) ([]HistoryRecord, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query("SELECT id, name, file_type, pages, copies, printer_name, status, created_at, duration, error, cost, user, department FROM history ORDER BY created_at DESC LIMIT ?", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]HistoryRecord, 0)
	for rows.Next() {
		var h HistoryRecord
		var pages, copies, cost int
		var user, dept sql.NullString
		if err := rows.Scan(&h.ID, &h.Name, &h.FileType, &pages, &copies, &h.PrinterName, &h.Status, &h.CreatedAt, &h.Duration, &h.Error, &cost, &user, &dept); err != nil {
			return nil, err
		}
		h.Pages = pages
		h.Copies = copies
		h.Cost = cost
		h.User = user.String
		if h.User == "" {
			h.User = "Andi Ahmad"
		}
		h.Department = dept.String
		if h.Department == "" {
			h.Department = "Engineering"
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (s *Store) AddHistory(h HistoryRecord) error {
	if h.ID == "" {
		h.ID = uuid.NewString()
	}
	if h.CreatedAt == 0 {
		h.CreatedAt = time.Now().UnixMilli()
	}
	if h.User == "" {
		h.User = "Andi Ahmad"
	}
	if h.Department == "" {
		h.Department = "Engineering"
	}
	_, err := s.db.Exec(`
		INSERT INTO history (id, name, file_type, pages, copies, printer_name, status, created_at, duration, error, cost, user, department)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		h.ID, h.Name, h.FileType, h.Pages, h.Copies, h.PrinterName, h.Status, h.CreatedAt, h.Duration, h.Error, h.Cost, h.User, h.Department,
	)
	return err
}

// ClearHistory removes all history records.
func (s *Store) ClearHistory() error {
	_, err := s.db.Exec("DELETE FROM history")
	return err
}

// CompleteJobToHistory finalizes a job and stores it in history.
func (s *Store) CompleteJobToHistory(j Job, status, errMsg string) error {
	now := time.Now().UnixMilli()
	printerName := ""
	if j.PrinterID != "" {
		var n string
		_ = s.db.QueryRow("SELECT name FROM printers WHERE id = ?", j.PrinterID).Scan(&n)
		printerName = n
	}
	duration := fmt.Sprintf("%ds", int((now-j.CreatedAt)/1000))
	j.Status = status
	j.CompletedAt = &now
	if errMsg != "" {
		j.Status = "failed"
	}
	if err := s.UpdateJob(j); err != nil {
		return err
	}
	return s.AddHistory(HistoryRecord{
		Name:        j.Name,
		FileType:    j.FileType,
		Pages:       j.Pages,
		Copies:      j.Copies,
		PrinterName: printerName,
		Status:      status,
		CreatedAt:   now,
		Duration:    duration,
		Error:       errMsg,
		Cost:        j.Cost,
		User:        j.User,
		Department:  j.Department,
	})
}

// ── Settings ──

func (s *Store) GetSetting(key, def string) string {
	var v string
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&v)
	if err != nil {
		return def
	}
	return v
}

func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

var _ = json.Marshal // keep import if unused later
