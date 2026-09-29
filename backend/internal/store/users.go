package store

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// ErrDuplicateUsername is returned when inserting an existing username.
var ErrDuplicateUsername = errors.New("username already exists")

// ValidRole reports whether r is one of the supported roles.
func ValidRole(r string) bool {
	return r == "admin" || r == "user" || r == "guest"
}

// User is an account able to sign in to KroomPrint.
type User struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt int64  `json:"createdAt"`
}

const userCols = `id, username, role, created_at`

func scanUser(row interface{ Scan(...any) error }) (User, error) {
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt); err != nil {
		return u, err
	}
	return u, nil
}

// seedDefaultAdmin creates the bootstrap admin account on an empty users table.
func (s *Store) seedDefaultAdmin() error {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("Kolab2026"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)`,
		uuid.NewString(), "Kolab", string(hash), "admin", nowMS(),
	)
	return err
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query("SELECT " + userCols + " FROM users ORDER BY created_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]User, 0)
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) GetUserByUsername(username string) (id, hash, role string, err error) {
	err = s.db.QueryRow(
		`SELECT id, password_hash, role FROM users WHERE LOWER(username) = LOWER(?)`, strings.TrimSpace(username),
	).Scan(&id, &hash, &role)
	return
}

func (s *Store) CreateUser(username, password, role string) (User, error) {
	if !ValidRole(role) {
		return User{}, errors.New("invalid role")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	u := User{ID: uuid.NewString(), Username: username, Role: role, CreatedAt: nowMS()}
	_, err = s.db.Exec(
		`INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)`,
		u.ID, u.Username, string(hash), u.Role, u.CreatedAt,
	)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unique") {
		return User{}, ErrDuplicateUsername
	}
	return u, err
}

func (s *Store) UpdateUserRole(id, role string) error {
	if !ValidRole(role) {
		return errors.New("invalid role")
	}
	_, err := s.db.Exec(`UPDATE users SET role = ? WHERE id = ?`, role, id)
	return err
}

func (s *Store) UpdateUserPassword(id, newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, string(hash), id)
	return err
}

func (s *Store) GetUserPasswordHash(id string) (string, error) {
	var hash string
	err := s.db.QueryRow(`SELECT password_hash FROM users WHERE id = ?`, id).Scan(&hash)
	return hash, err
}

func (s *Store) DeleteUser(id string) error {
	_, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

func (s *Store) CountUsersByRole(role string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = ?`, role).Scan(&n)
	return n, err
}

func (s *Store) SettingValue(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

func (s *Store) SaveSetting(key, val string) error {
	_, err := s.db.Exec(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, val,
	)
	return err
}
