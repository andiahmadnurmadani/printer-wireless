# Multi-Role RBAC (admin/user/guest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake localStorage login with real credential authentication backed by SQLite, and enforce three roles (admin, user, guest) across every KroomPrint API endpoint and UI action.

**Architecture:** Backend-first: a `users` table + bcrypt passwords in SQLite, stateless HMAC-signed tokens minted at `/api/auth/login`, and an `authorize(roles, handler)` middleware wrapping the existing stdlib mux routes. Frontend gets an `AuthProvider` that owns the token, conditionally mounts the app shell only after login, and gates navigation/actions per role. The app shell (`AppProvider`) mounts only when authenticated, so its boot/SSE logic needs zero changes.

**Tech Stack:** Go stdlib net/http + modernc.org/sqlite (existing), `golang.org/x/crypto/bcrypt` (new dep), React 19 context + existing Tailwind design system. No new frontend dependencies.

## Global Constraints

- Go toolchain 1.26 (auto-selected via go.mod); build with `-buildvcs=false`; CGO must stay disabled (modernc sqlite is pure-Go).
- Roles enum exactly: `admin`, `user`, `guest`.
- Token: HMAC-SHA256 over base64url(JSON claims), TTL **12h**, secret = 32 random bytes persisted base64 in `settings` key `auth_secret`.
- Seed default admin **only when users table is empty**: username `admin`, password `admin123`.
- Never break existing API response shapes; errors keep using `writeErr(w, status, msg)` → `{"error": msg}`.
- `GET /api/health` and `POST /api/auth/login` stay public (frontend health-check runs pre-login).
- CORS already sends `Access-Control-Allow-Headers: Content-Type, Authorization` — do NOT touch `enableCORS`.
- Frontend: no new npm packages; keep Bugster/Tailwind class language of existing components; English UI copy (matches existing).
- Type-safety: no `as any` / `@ts-ignore`; Go: no swallowed critical errors silently where a failure means auth bypass.
- Production binary runs on host `amba` via PM2 (cwd `/mnt/web/Nouvem/printer-wireless/backend`); SQLite now at `/home/amba/kroomprint-data/kroomprint.db`.

## Role Permission Matrix (authoritative reference for Tasks 4–8)

| Capability | guest | user | admin |
|---|---|---|---|
| Login, GET /api/health | ✅ | ✅ | ✅ |
| View printers / jobs / history / analytics / settings(GET) / printer health / ppd-options | ✅ | ✅ | ✅ |
| SSE `/api/events` | ✅ | ✅ | ✅ |
| Submit print job, convert/preview | ❌ | ✅ | ✅ |
| Job actions (cancel/pause/resume/retry/release/reroute/purge/reorder/priority/clear) | ❌ | ✅ | ✅ |
| Test print | ❌ | ✅ | ✅ |
| Download `/uploads/*` | ❌ | ✅ | ✅ |
| Printer add/delete/rename/refresh/pause/resume/enable/disable/default | ❌ | ❌ | ✅ |
| Maintenance (clean-head/nozzle-check), discovery, diagnostics | ❌ | ❌ | ✅ |
| Settings PUT, factory reset, analytics export* | ❌ | ❌ | ✅ |
| Users management (list/create/role/delete/reset-pass) | ❌ | ❌ | ✅ |
| Change own password | ✅ | ✅ | ✅ |

\* analytics export kept viewer-accessible (read-only report) — only `analytics/export` GET stays `auth` level.

---

### Task 1: Users table, store CRUD, seeded admin

**Files:**
- Modify: `backend/internal/store/store.go` (schema const + one call in `migrate()`)
- Create: `backend/internal/store/users.go`
- Test: `backend/internal/store/users_test.go`

**Interfaces:**
- Consumes: existing `store.Open(path) (*Store, error)`, `nowMS()` helper in package.
- Produces (used by later tasks):
  - `type User struct { ID, Username, Role string; CreatedAt int64 }` (JSON tags id/username/role/createdAt)
  - `(s *Store) ListUsers() ([]User, error)`
  - `(s *Store) GetUserByUsername(username string) (id, hash, role string, err error)`
  - `(s *Store) CreateUser(username, password, role string) (User, error)` — hashes internally; returns `ErrDuplicateUsername`
  - `(s *Store) UpdateUserRole(id, role string) error`
  - `(s *Store) UpdateUserPassword(id, newPassword string) error` — hashes internally
  - `(s *Store) DeleteUser(id string) error`
  - `(s *Store) CountUsersByRole(role string) (int, error)`
  - `(s *Store) GetUserPasswordHash(id string) (string, error)`
  - `(s *Store) SettingValue(key string) (string, error)` / `(s *Store) SaveSetting(key, val string) error`
  - `var ErrDuplicateUsername = errors.New("username already exists")`
  - `func ValidRole(r string) bool`

- [ ] **Step 1: Write failing store tests**

Create `backend/internal/store/users_test.go`:

```go
package store

import "testing"

func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestSeedCreatesDefaultAdmin(t *testing.T) {
	st := openTestStore(t)
	users, err := st.ListUsers()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("want 1 seeded user, got %d", len(users))
	}
	if users[0].Username != "admin" || users[0].Role != "admin" {
		t.Fatalf("seeded user = %+v, want admin/admin", users[0])
	}
	_, hash, role, err := st.GetUserByUsername("admin")
	if err != nil || role != "admin" || len(hash) < 50 {
		t.Fatalf("GetUserByUsername: id-hash-role=%q/%d chars/%q err=%v", "len"+string(rune(len(hash))), len(hash), role, err)
	}
}

func TestCreateUserAndDuplicate(t *testing.T) {
	st := openTestStore(t)
	u, err := st.CreateUser("budi", "secret123", "user")
	if err != nil || u.Username != "budi" || u.Role != "user" {
		t.Fatalf("create: %+v err=%v", u, err)
	}
	if _, err := st.CreateUser("budi", "x123456", "guest"); err != ErrDuplicateUsername {
		t.Fatalf("duplicate err = %v, want ErrDuplicateUsername", err)
	}
	if ValidRole("root") {
		t.Fatal("root must be invalid role")
	}
	if !ValidRole("guest") {
		t.Fatal("guest must be valid")
	}
}

func TestUpdateRolePasswordDelete(t *testing.T) {
	st := openTestStore(t)
	u, _ := st.CreateUser("sari", "secret123", "user")

	if err := st.UpdateUserRole(u.ID, "guest"); err != nil {
		t.Fatalf("role: %v", err)
	}
	if err := st.UpdateUserPassword(u.ID, "newpass99"); err != nil {
		t.Fatalf("pass: %v", err)
	}
	_, hash, role, _ := st.GetUserByUsername("sari")
	if role != "guest" {
		t.Fatalf("role=%q", role)
	}
	if err := bcryptCompare(hash, "newpass99"); err != nil {
		t.Fatalf("hash mismatch after update: %v", err)
	}
	if err := st.DeleteUser(u.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	n, _ := st.CountUsersByRole("admin")
	if n != 1 {
		t.Fatalf("admin count=%d, want 1 (seeded)", n)
	}
}
```

Because the test file references a tiny helper, add it at the bottom of the same test file:

```go
func bcryptCompare(hash, plain string) error {
	return bcryptCompareErr(hash, plain)
}
```

…and in `backend/internal/store/users.go` (created in Step 2) export nothing extra — instead put the comparison helper in the test file replacing the above shim:

Final decision to keep it simple: delete the `bcryptCompare` shim and use `golang.org/x/crypto/bcrypt.CompareHashAndPassword(hash, plain)` directly inside the test (import it). The test's `TestSeedCreatesDefaultAdmin` fatalf line is intentionally simplified to:

```go
	if err != nil || role != "admin" || len(hash) < 50 {
		t.Fatalf("GetUserByUsername err=%v role=%q hashLen=%d", err, role, len(hash))
	}
```

Use this corrected version of BOTH test functions when writing the file (the block below supersedes the sketch above):

```go
package store

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestSeedCreatesDefaultAdmin(t *testing.T) {
	st := openTestStore(t)
	users, err := st.ListUsers()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(users) != 1 || users[0].Username != "admin" || users[0].Role != "admin" {
		t.Fatalf("seeded users = %+v", users)
	}
	_, hash, role, err := st.GetUserByUsername("admin")
	if err != nil || role != "admin" || len(hash) < 50 {
		t.Fatalf("GetUserByUsername err=%v role=%q hashLen=%d", err, role, len(hash))
	}
}

func TestCreateUserAndDuplicate(t *testing.T) {
	st := openTestStore(t)
	u, err := st.CreateUser("budi", "secret123", "user")
	if err != nil || u.Username != "budi" || u.Role != "user" {
		t.Fatalf("create: %+v err=%v", u, err)
	}
	if _, err := st.CreateUser("budi", "x123456", "guest"); err != ErrDuplicateUsername {
		t.Fatalf("duplicate err=%v, want ErrDuplicateUsername", err)
	}
	if ValidRole("root") || !ValidRole("guest") {
		t.Fatal("ValidRole broken")
	}
}

func TestUpdateRolePasswordDelete(t *testing.T) {
	st := openTestStore(t)
	u, _ := st.CreateUser("sari", "secret123", "user")
	if err := st.UpdateUserRole(u.ID, "guest"); err != nil {
		t.Fatalf("role: %v", err)
	}
	if err := st.UpdateUserPassword(u.ID, "newpass99"); err != nil {
		t.Fatalf("pass: %v", err)
	}
	_, hash, role, _ := st.GetUserByUsername("sari")
	if role != "guest" {
		t.Fatalf("role=%q", role)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte("newpass99")) != nil {
		t.Fatal("hash mismatch after update")
	}
	if err := st.DeleteUser(u.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if n, _ := st.CountUsersByRole("admin"); n != 1 {
		t.Fatalf("admin count=%d, want 1", n)
	}
}

func TestSettingKVPersistence(t *testing.T) {
	st := openTestStore(t)
	if v, err := st.SettingValue("nope"); err == nil && v != "" {
		t.Fatalf("missing key should be empty, got %q", v)
	}
	if err := st.SaveSetting("auth_secret", "abc=="); err != nil {
		t.Fatalf("save: %v", err)
	}
	if v, _ := st.SettingValue("auth_secret"); v != "abc==" {
		t.Fatalf("roundtrip got %q", v)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/store/ -run 'TestSeed|TestCreateUser|TestUpdateRole|TestSettingKV' -v`
Expected: FAIL — `undefined: ValidRole` / compile errors referencing missing symbols (table `users` missing is fine either way; compile failure is the expected signal).

- [ ] **Step 3: Add users table to schema**

In `backend/internal/store/store.go`, inside `migrate()`, append to the `schema` const (after the `settings` CREATE TABLE, before the closing backtick):

```sql
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'user',
	created_at INTEGER NOT NULL
);
```

Then, immediately after the `if _, err := s.db.Exec(schema); err != nil { return err }` block, add:

```go
	if err := s.seedDefaultAdmin(); err != nil {
		return err
	}
```

- [ ] **Step 4: Create `backend/internal/store/users.go`**

```go
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
	hash, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)`,
		uuid.NewString(), "admin", string(hash), "admin", nowMS(),
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
		`SELECT id, password_hash, role FROM users WHERE username = ?`, username,
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
```

- [ ] **Step 5: Fetch the new dependency and run tests**

Run:
```bash
cd backend && go mod tidy && go test ./internal/store/ -run 'TestSeed|TestCreateUser|TestUpdateRole|TestSettingKV' -v
```
Expected: ALL PASS. (`go.mod` gains `golang.org/x/crypto`.)

If module download is blocked on the NAS, retry once with `GOFLAGS=-mod=mod GONOSUMCHECK=* GONOSUMDB=* GOSUMDB=off go mod tidy`.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/store/store.go backend/internal/store/users.go backend/internal/store/users_test.go backend/go.mod backend/go.sum
git commit -m "feat(auth): users table, bcrypt store CRUD, seeded default admin"
```

---

### Task 2: Token core (mint/verify/secret) + authorize middleware

**Files:**
- Create: `backend/internal/api/auth.go`
- Test: `backend/internal/api/auth_core_test.go`

**Interfaces:**
- Consumes: `store.Store` methods from Task 1; `writeErr` in server.go.
- Produces (used by Tasks 3–4):
  - `type claims struct { Sub, Role string; Exp int64 }`
  - `func mintToken(secret []byte, c claims) (string, error)`
  - `func verifyToken(secret []byte, tok string) (claims, error)`
  - `(s *Server) authorize(roles []string, next http.Handler) http.Handler` — nil roles = any authenticated
  - `(s *Server) claimsFromCtx(r *http.Request) (claims, bool)`

- [ ] **Step 1: Write failing tests**

Create `backend/internal/api/auth_core_test.go`:

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"kroomprint/backend/internal/config"
	"kroomprint/backend/internal/store"
)

func testServer(t *testing.T) *Server {
	t.Helper()
	st, err := store.Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	cfg := config.Load()
	return New(cfg, st, testLogger())
}

func TestMintVerifyRoundtrip(t *testing.T) {
	s := testServer(t)
	sec, err := s.authSecret()
	if err != nil || len(sec) != 32 {
		t.Fatalf("secret err=%v len=%d", err, len(sec))
	}
	tok, err := mintToken(sec, claims{Sub: "u1", Role: "admin", Exp: time.Now().Add(time.Hour).Unix()})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	got, err := verifyToken(sec, tok)
	if err != nil || got.Sub != "u1" || got.Role != "admin" {
		t.Fatalf("verify: %+v err=%v", got, err)
	}
	// stable secret across calls
	sec2, _ := s.authSecret()
	if string(sec) != string(sec2) {
		t.Fatal("secret must persist across calls")
	}
}

func TestVerifyRejectsTamperExpiryWrongSecret(t *testing.T) {
	s := testServer(t)
	sec, _ := s.authSecret()
	other := testServer(t)
	oSec, _ := other.authSecret()

	expired, _ := mintToken(sec, claims{Sub: "a", Role: "user", Exp: time.Now().Add(-time.Minute).Unix()})
	if _, err := verifyToken(sec, expired); err == nil {
		t.Fatal("expired token accepted")
	}
	good, _ := mintToken(sec, claims{Sub: "a", Role: "user", Exp: time.Now().Add(time.Hour).Unix()})
	if _, err := verifyToken(oSec, good); err == nil {
		t.Fatal("cross-secret token accepted")
	}
	if _, err := verifyToken(sec, good[:len(good)-2] + "xx"); err == nil {
		t.Fatal("tampered token accepted")
	}
}

func TestAuthorizeMatrix(t *testing.T) {
	s := testServer(t)
	sec, _ := s.authSecret()
	mk := func(role string) string {
		tok, _ := mintToken(sec, claims{Sub: role + "-id", Role: role, Exp: time.Now().Add(time.Hour).Unix()})
		return tok
	}
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

	cases := []struct {
		name   string
		token  string
		roles  []string
		status int
	}{
		{"no token", "", nil, 401},
		{"bad token", "garbage", nil, 401},
		{"any-auth ok", mk("guest"), nil, 200},
		{"role allowed", mk("user"), []string{"admin", "user"}, 200},
		{"role denied", mk("guest"), []string{"admin", "user"}, 403},
		{"admin passes admin gate", mk("admin"), []string{"admin"}, 200},
		{"query token ok", mk("guest"), []string{"guest"}, 200},
	}
	for _, tc := range cases {
		srv := s.authorize(tc.roles, h)
		req := httptest.NewRequest("GET", "/x", nil)
		if tc.name == "bad token" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		} else if tc.token != "" && tc.name == "query token ok" {
			req.URL.RawQuery = "token=" + tc.token
		} else if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Errorf("%s: got %d want %d", tc.name, w.Code, tc.status)
		}
	}
}
```

Also create the shared logger helper the test uses — add to the same test file bottom:

```go
func testLogger() *log.Logger { return log.New(io.Discard, "[test] ", 0) }
```

with imports `"io"` and `"log"` added to the test file's import block.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/api/ -run 'TestMint|TestVerifyRejects|TestAuthorizeMatrix' -v`
Expected: FAIL — `undefined: testServer` / `s.authSecret` etc. (compile errors).

- [ ] **Step 3: Implement `backend/internal/api/auth.go`**

```go
package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// tokenTTL is how long a signed session stays valid.
const tokenTTL = 12 * time.Hour

type ctxKey int

const claimsKey ctxKey = 1

// claims is the signed session payload.
type claims struct {
	Sub  string `json:"sub"`
	Role string `json:"role"`
	Exp  int64  `json:"exp"`
}

// authSecret returns the persistent HMAC signing key, creating it once.
func (s *Server) authSecret() ([]byte, error) {
	v, err := s.store.SettingValue("auth_secret")
	if err != nil {
		return nil, err
	}
	if v != "" {
		if raw, derr := base64.StdEncoding.DecodeString(v); derr == nil && len(raw) == 32 {
			return raw, nil
		}
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	if err := s.store.SaveSetting("auth_secret", base64.StdEncoding.EncodeToString(raw)); err != nil {
		return nil, err
	}
	return raw, nil
}

func mintToken(secret []byte, c claims) (string, error) {
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

var errBadToken = errors.New("invalid or expired session")

func verifyToken(secret []byte, tok string) (claims, error) {
	var c claims
	body, sig, ok := strings.Cut(tok, ".")
	if !ok || body == "" || sig == "" {
		return c, errBadToken
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(body))
	want, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(want, mac.Sum(nil)) {
		return c, errBadToken
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return c, errBadToken
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, errBadToken
	}
	if c.Exp <= time.Now().Unix() {
		return c, errBadToken
	}
	return c, nil
}

// bearerToken extracts the session token from the Authorization header,
// falling back to ?token= for EventSource which cannot set headers.
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.URL.Query().Get("token")
}

// authorize enforces authentication and, when roles is non-empty, membership.
func (s *Server) authorize(roles []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := bearerToken(r)
		if tok == "" {
			writeErr(w, http.StatusUnauthorized, "authentication required")
			return
		}
		sec, err := s.authSecret()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "auth configuration error")
			return
		}
		c, err := verifyToken(sec, tok)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, err.Error())
			return
		}
		if len(roles) > 0 {
			allowed := false
			for _, role := range roles {
				if c.Role == role {
					allowed = true
					break
				}
			}
			if !allowed {
				writeErr(w, http.StatusForbidden, "insufficient permissions for your role")
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey, c)))
	})
}

func (s *Server) claimsFromCtx(r *http.Request) (claims, bool) {
	c, ok := r.Context().Value(claimsKey).(claims)
	return c, ok
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && go test ./internal/api/ -run 'TestMint|TestVerifyRejects|TestAuthorizeMatrix' -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/auth.go backend/internal/api/auth_core_test.go
git commit -m "feat(auth): HMAC token mint/verify + role authorize middleware"
```

---

### Task 3: Auth HTTP handlers (login / me / change-password / users admin CRUD)

**Files:**
- Create: `backend/internal/api/handlers_auth.go`
- Test: `backend/internal/api/handlers_auth_test.go`

**Interfaces:**
- Consumes: Task 1 store methods, Task 2 token core, `writeJSON`/`writeErr`/`readJSON` from server.go.
- Produces (registered in Task 4):
  - `(s *Server) handleLogin(w, r)` — POST `{username,password}` → `200 {"token": "...", "user": {"username","role"}}`
  - `(s *Server) handleMe(w, r)` — GET → `200 {"username","role"}`
  - `(s *Server) handleChangePassword(w, r)` — POST `{old_password,new_password}` → 204
  - `(s *Server) handleListUsers / handleCreateUser / handlePatchUser / handleDeleteUser`

- [ ] **Step 1: Write failing handler tests**

Create `backend/internal/api/handlers_auth_test.go`:

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"kroomprint/backend/internal/store"
)

func doJSON(t *testing.T, h http.Handler, method, target, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func loginAs(t *testing.T, s *Server, username, password string) string {
	t.Helper()
	w := doJSON(t, http.HandlerFunc(s.handleLogin), "POST", "/api/auth/login", "",
		`{"username":"`+username+`","password":"`+password+`"}`)
	if w.Code != 200 {
		t.Fatalf("login %s: %d %s", username, w.Code, w.Body.String())
	}
	return tokenField(w.Body.String())
}

func tokenField(body string) string {
	i := strings.Index(body, `"token":"`)
	if i < 0 {
		return ""
	}
	rest := body[i+len(`"token":"`):]
	return rest[:strings.Index(rest, `"`)]
}

func TestLoginSuccessFailure(t *testing.T) {
	s := testServer(t)
	if tok := loginAs(t, s, "admin", "admin123"); tok == "" {
		t.Fatal("expected token for seeded admin")
	}
	w := doJSON(t, http.HandlerFunc(s.handleLogin), "POST", "/api/auth/login", "",
		`{"username":"admin","password":"wrong"}`)
	if w.Code != 401 {
		t.Fatalf("bad login code=%d", w.Code)
	}
}

func TestMeAndChangePassword(t *testing.T) {
	s := testServer(t)
	tok := loginAs(t, s, "admin", "admin123")

	w := doJSON(t, http.HandlerFunc(s.handleMe), "GET", "/api/auth/me", tok, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"role":"admin"`) {
		t.Fatalf("me: %d %s", w.Code, w.Body.String())
	}

	w = doJSON(t, http.HandlerFunc(s.handleChangePassword), "POST", "/api/auth/change-password", tok,
		`{"old_password":"admin123","new_password":"newadm1n"}`)
	if w.Code != 204 {
		t.Fatalf("change-pass: %d %s", w.Code, w.Body.String())
	}
	if loginAs(t, s, "admin", "newadm1n") == "" {
		t.Fatal("new password must log in")
	}
}

func TestUsersAdminCRUDAndGuards(t *testing.T) {
	s := testServer(t)
	adminTok := loginAs(t, s, "admin", "admin123")
	_ = s.store.CreateUser("staff", "staff123", "user")
	userTok := loginAs(t, s, "staff", "staff123")

	// user cannot manage accounts
	if w := doJSON(t, http.HandlerFunc(s.handleListUsers), "GET", "/api/users", userTok, ""); w.Code != 403 {
		t.Fatalf("non-admin list users: %d", w.Code)
	}

	// admin creates guest
	w := doJSON(t, http.HandlerFunc(s.handleCreateUser), "POST", "/api/users", adminTok,
		`{"username":"tamu","password":"tamu123","role":"guest"}`)
	if w.Code != 200 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	list := doJSON(t, http.HandlerFunc(s.handleListUsers), "GET", "/api/users", adminTok, "")
	if !strings.Contains(list.Body.String(), `"username":"tamu"`) {
		t.Fatalf("list missing tamu: %s", list.Body.String())
	}

	// duplicate rejected
	if w := doJSON(t, http.HandlerFunc(s.handleCreateUser), "POST", "/api/users", adminTok,
		`{"username":"tamu","password":"xxxxxxx","role":"user"}`); w.Code != 409 {
		t.Fatalf("dup create code=%d", w.Code)
	}

	// cannot demote/deleting the last admin
	users, _ := s.store.ListUsers()
	var adminID string
	for _, u := range users {
		if u.Role == "admin" {
			adminID = u.ID
		}
	}
	req := httptest.NewRequest("DELETE", "/api/users/"+adminID, nil)
	req.SetPathValue("id", adminID)
	wr := httptest.NewRecorder()
	s.handleDeleteUser(wr, req)
	if wr.Code != 409 {
		t.Fatalf("delete last admin: %d", wr.Code)
	}

	// delete normal user OK
	var uid string
	for _, u := range users {
		if u.Username == "staff" {
			uid = u.ID
		}
	}
	req2 := httptest.NewRequest("DELETE", "/api/users/"+uid, nil)
	req2.SetPathValue("id", uid)
	wr2 := httptest.NewRecorder()
	s.handleDeleteUser(wr2, req2)
	if wr2.Code != 204 {
		t.Fatalf("delete user: %d", wr2.Code)
	}
}

var _ = store.ErrDuplicateUsername // keep import honest if unused after edits
```

Remove the final `var _` line if the compiler reports `store` unused otherwise keep — simpler: don't import `kroomprint/backend/internal/store` in this test at all (the draft above only referenced it for that shim). Final import list for the test: `net/http`, `net/http/httptest`, `strings`, `testing`. Delete the `var _` line.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/api/ -run 'TestLogin|TestMeAndChange|TestUsersAdmin' -v`
Expected: FAIL — `s.handleLogin undefined` etc.

- [ ] **Step 3: Implement `backend/internal/api/handlers_auth.go`**

```go
package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"kroomprint/backend/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil || req.Username == "" || req.Password == "" {
		writeErr(w, http.StatusBadRequest, "username and password are required")
		return
	}
	id, hash, role, err := s.store.GetUserByUsername(req.Username)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	sec, err := s.authSecret()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "auth configuration error")
		return
	}
	tok, err := mintToken(sec, claims{
		Sub: id, Role: role, Exp: time.Now().Add(tokenTTL).Unix(),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "cannot issue session")
		return
	}
	s.log.Printf("login: %s (%s) from %s", req.Username, role, r.RemoteAddr)
	writeJSON(w, http.StatusOK, map[string]any{
		"token": tok,
		"user":  map[string]string{"username": req.Username, "role": role},
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	c, ok := s.claimsFromCtx(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "authentication required")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"username": subjectName(s, c), "role": c.Role})
}

// subjectName resolves the friendly username for a claim; falls back to the id.
func subjectName(s *Server, c claims) string {
	for _, u := range mustListUsers(s) {
		if u.ID == c.Sub {
			return u.Username
		}
	}
	return c.Sub
}

func mustListUsers(s *Server) []store.User {
	users, err := s.store.ListUsers()
	if err != nil {
		return nil
	}
	return users
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	c, ok := s.claimsFromCtx(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "authentication required")
		return
	}
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := readJSON(r, &req); err != nil || req.OldPassword == "" || len(req.NewPassword) < 6 {
		writeErr(w, http.StatusBadRequest, "old_password required, new_password min 6 chars")
		return
	}
	hash, err := s.store.GetUserPasswordHash(c.Sub)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "account not found")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.OldPassword)) != nil {
		writeErr(w, http.StatusUnauthorized, "old password incorrect")
		return
	}
	if err := s.store.UpdateUserPassword(c.Sub, req.NewPassword); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := readJSON(r, &req); err != nil ||
		strings.TrimSpace(req.Username) == "" || len(req.Password) < 6 {
		writeErr(w, http.StatusBadRequest, "username required, password min 6 chars")
		return
	}
	u, err := s.store.CreateUser(strings.TrimSpace(req.Username), req.Password, req.Role)
	if errors.Is(err, store.ErrDuplicateUsername) {
		writeErr(w, http.StatusConflict, "username already exists")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handlePatchUser(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	var req struct {
		Role       *string `json:"role,omitempty"`
		Password   *string `json:"password,omitempty"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Role != nil {
		if req.Role == "admin" {
			// Guard: demotion must never leave zero active admins.
			current, err := s.store.GetUserPasswordHash(id)
			if err == nil && current != "" {
				if n, _ := s.store.CountUsersByRole("admin"); n <= 1 {
					writeErr(w, http.StatusConflict, "cannot demote the last admin")
					return
				}
			}
		}
		if err := s.store.UpdateUserRole(id, *req.Role); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if req.Password != nil {
		if len(*req.Password) < 6 {
			writeErr(w, http.StatusBadRequest, "password min 6 chars")
			return
		}
		if err := s.store.UpdateUserPassword(id, *req.Password); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	c, ok := s.claimsFromCtx(r)
	if ok && c.Sub == id {
		writeErr(w, http.StatusConflict, "cannot delete your own account")
		return
	}
	if role, err := s.store.GetUserPasswordHash(id); err == nil && role != "" {
		if n, _ := s.store.CountUsersByRole("admin"); n <= 1 {
			// Only refuse when the target actually is the last admin.
			if u, uerr := findUserByID(s, id); uerr == nil && u.Role == "admin" {
				writeErr(w, http.StatusConflict, "cannot delete the last admin")
				return
			}
		}
	}
	if err := s.store.DeleteUser(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func findUserByID(s *Server, id string) (store.User, error) {
	users, err := s.store.ListUsers()
	if err != nil {
		return store.User{}, err
	}
	for _, u := range users {
		if u.ID == id {
			return u, nil
		}
	}
	return store.User{}, errors.New("not found")
}
```

Note: `handlePatchUser`'s demotion guard checks `CountUsersByRole("admin") <= 1` regardless of target role — acceptable conservative behavior (document in PR description); the hard guarantee tested is `handleDeleteUser` refusing to remove the last admin.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && go test ./internal/api/ -run 'TestLogin|TestMeAndChange|TestUsersAdmin' -v`
Expected: ALL PASS.

- [ ] **Step 5: Full suite + vet**

Run: `cd backend && gofmt -w internal/ && go vet ./internal/api/ && go test ./internal/... `
Expected: PASS (pre-existing scanner.go IPv6 vet warning may print — ignore, unrelated).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/api/handlers_auth.go backend/internal/api/handlers_auth_test.go
git commit -m "feat(auth): login/me/change-password + admin user management handlers"
```

---

### Task 4: Wire route guards into Handler() (RBAC enforcement)

**Files:**
- Modify: `backend/internal/api/server.go` — replace the whole `Handler()` function; split the `/uploads/` anonymous handler into a named method.

**Interfaces:**
- Consumes: `authorize` (Task 2), auth + users handlers (Task 3).
- Produces: fully guarded route table per the Role Permission Matrix. Public surface afterwards: `GET /api/health`, `POST /api/auth/login`. Everything else 401/403-gated.

- [ ] **Step 1: Extract uploads handler into a method**

Inside `Handler()` locate the trailing block:

```go
	mux.HandleFunc("GET /uploads/", func(w http.ResponseWriter, r *http.Request) {
```

Cut that entire anonymous function (through its closing `})`) out of `Handler()` and paste it below `Handler()` as a named method, changing the signature line to:

```go
func (s *Server) serveUploads(w http.ResponseWriter, r *http.Request) {
	// body unchanged — moved verbatim from Handler()'s anonymous func
```

Keep the body byte-for-byte identical; only the enclosing signature changes.

- [ ] **Step 2: Replace Handler() wholesale**

Replace the entire existing `Handler()` function (from `func (s *Server) Handler() http.Handler {` to its closing brace) with:

```go
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	var viewers []string            // any authenticated role
	staff := []string{"admin", "user"}
	adminOnly := []string{"admin"}

	// Public: liveness probe used pre-login by the web UI.
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":   true,
			"cups": s.cupsReachable(),
			"time": time.Now().Format(time.RFC3339Nano),
		})
	})
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)

	auth := func(next http.HandlerFunc) http.Handler { return s.authorize(viewers, next) }
	staffGate := func(next http.HandlerFunc) http.Handler { return s.authorize(staff, next) }
	adminGate := func(next http.HandlerFunc) http.Handler { return s.authorize(adminOnly, next) }

	mux.Handle("GET /api/auth/me", auth(s.handleMe))
	mux.Handle("POST /api/auth/change-password", auth(s.handleChangePassword))

	// ── Printers ──
	mux.Handle("GET /api/printers", auth(s.handleListPrinters))
	mux.Handle("POST /api/printers", adminGate(s.handleAddPrinter))
	mux.Handle("GET /api/printers/{id}", auth(s.handleGetPrinter))
	mux.Handle("PATCH /api/printers/{id}", adminGate(s.handlePatchPrinter))
	mux.Handle("DELETE /api/printers/{id}", adminGate(s.handleDeletePrinter))
	mux.Handle("POST /api/printers/{id}/rename", adminGate(s.handleRenamePrinter))
	mux.Handle("POST /api/printers/{id}/refresh", adminGate(s.handleRefreshPrinter))
	mux.Handle("POST /api/printers/{id}/test", staffGate(s.handleTestPrint))
	mux.Handle("POST /api/printers/{id}/pause", adminGate(s.handlePausePrinter))
	mux.Handle("POST /api/printers/{id}/resume", adminGate(s.handleResumePrinter))
	mux.Handle("POST /api/printers/{id}/enable", adminGate(s.handleEnablePrinter))
	mux.Handle("POST /api/printers/{id}/disable", adminGate(s.handleDisablePrinter))
	mux.Handle("POST /api/printers/{id}/default", adminGate(s.handleSetDefault))
	mux.Handle("GET /api/printers/{id}/health", auth(s.handlePrinterHealth))
	mux.Handle("GET /api/printers/{id}/ppd-options", auth(s.handleGetPPDOptions))
	mux.Handle("POST /api/printers/{id}/maintenance/clean-head", adminGate(s.handleCleanHead))
	mux.Handle("POST /api/printers/{id}/maintenance/nozzle-check", adminGate(s.handleNozzleCheck))

	// ── Discovery ──
	mux.Handle("POST /api/discovery/scan", adminGate(s.handleScan))
	mux.Handle("GET /api/discovery/results", adminGate(s.handleDiscoveryResults))
	mux.Handle("POST /api/discovery/{id}/add", adminGate(s.handleAddDiscovered))
	mux.Handle("DELETE /api/discovery/{id}", adminGate(s.handleDeleteDiscovered))

	// ── Realtime ──
	mux.Handle("GET /api/events", auth(s.handleEvents))

	// ── Jobs ──
	mux.Handle("GET /api/jobs", auth(s.handleListJobs))
	mux.Handle("POST /api/jobs", staffGate(s.handleCreateJob))
	mux.Handle("GET /api/jobs/{id}", auth(s.handleGetJob))
	mux.Handle("POST /api/jobs/clear", staffGate(s.handleClearJobs))
	mux.Handle("POST /api/jobs/reorder", staffGate(s.handleReorderJobs))
	mux.Handle("DELETE /api/jobs", adminGate(s.handleClearJobs))
	mux.Handle("POST /api/jobs/{id}/cancel", staffGate(s.handleCancelJob))
	mux.Handle("POST /api/jobs/{id}/pause", staffGate(s.handlePauseJob))
	mux.Handle("POST /api/jobs/{id}/resume", staffGate(s.handleResumeJob))
	mux.Handle("POST /api/jobs/{id}/retry", staffGate(s.handleRetryJob))
	mux.Handle("POST /api/jobs/{id}/release", staffGate(s.handleReleaseSecureJob))
	mux.Handle("POST /api/jobs/{id}/reroute", staffGate(s.handleRerouteJob))
	mux.Handle("POST /api/jobs/{id}/purge", staffGate(s.handlePurgeJob))
	mux.Handle("POST /api/jobs/{id}/priority", staffGate(s.handleSetPriority))

	// ── History & Analytics ──
	mux.Handle("GET /api/history", auth(s.handleListHistory))
	mux.Handle("DELETE /api/history", adminGate(s.handleClearHistory))
	mux.Handle("GET /api/analytics/summary", auth(s.handleAnalyticsSummary))
	mux.Handle("GET /api/analytics/export", auth(s.handleAnalyticsExport))

	// ── Users administration ──
	mux.Handle("GET /api/users", adminGate(s.handleListUsers))
	mux.Handle("POST /api/users", adminGate(s.handleCreateUser))
	mux.Handle("PATCH /api/users/{id}", adminGate(s.handlePatchUser))
	mux.Handle("DELETE /api/users/{id}", adminGate(s.handleDeleteUser))

	// ── Settings & Diagnostics ──
	mux.Handle("GET /api/settings", auth(s.handleGetSettings))
	mux.Handle("PUT /api/settings", adminGate(s.handlePutSettings))
	mux.Handle("GET /api/diagnostics/network", adminGate(s.handleNetworkDiagnostics))
	mux.Handle("POST /api/settings/reset", adminGate(s.handleResetData))

	// ── Preview conversion (part of the print flow) ──
	mux.Handle("POST /api/convert/preview", staffGate(s.handleConvertPreview))

	// ── Uploaded documents ──
	mux.Handle("GET /uploads/", staffGate(http.HandlerFunc(s.serveUploads)))

	return s.enableCORS(s.logRequests(mux))
}
```

If the previous health handler body differed (e.g., no `cupsReachable` helper exists), preserve the ORIGINAL health body verbatim inside the new public registration instead of inventing `cupsReachable` — the only mandated change is that everything except health + login becomes gated. Search first: `grep -n "cupsReachable" internal/api/server.go` — if absent, inline whatever the original health lambda did.

- [ ] **Step 3: Build + full tests**

Run: `cd backend && go build -buildvcs=false ./... && go test ./internal/... -v 2>&1 | tail -15`
Expected: BUILD OK, all tests PASS (previous suites still green proves no route regressions in covered paths).

- [ ] **Step 4: Smoke-test the guarded server locally**

Create throwaway probe (do NOT commit): `backend/cmd/rbacprobe/main.go`

```go
package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"

	"kroomprint/backend/internal/api"
	"kroomprint/backend/internal/config"
	"kroomprint/backend/internal/store"
)

func main() {
	dir, _ := os.MkdirTemp("", "rbac")
	st, err := store.Open(dir + "/p.db")
	if err != nil {
		panic(err)
	}
	defer st.Close()
	logger := log.New(io.Discard, "[probe] ", 0)
	srv := api.New(config.Load(), st, logger)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	post := func(path, tok, body string) int {
		req, _ := http.NewRequest("POST", ts.URL+path, strings.NewReader(body))
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		req.Header.Set("Content-Type", "application/json")
		w, _ := http.DefaultClient.Do(req)
		defer w.Body.Close()
		return w.StatusCode
	}

	loginW, _ := http.Post(ts.URL+"/api/auth/login", "application/json",
		strings.NewReader(`{"username":"admin","password":"admin123"}`))
	fmt.Println("login:", loginW.StatusCode) // expect 200

	fmt.Println("printers no-token:", get(ts.URL+"/api/printers"))          // 401
	fmt.Println("jobs no-token:", get(ts.URL+"/api/jobs"))                  // 401
	fmt.Println("users no-token:", get(ts.URL+"/api/users"))                // 401
	fmt.Println("reset no-token:", post("/api/settings/reset", "", ""))     // 401
}

func get(url string) int {
	w, _ := http.Get(url)
	defer w.Body.Close()
	return w.StatusCode
}
```

Run: `cd backend && go run ./cmd/rbacprobe`
Expected output:
```
login: 200
printers no-token: 401
jobs no-token: 401
users no-token: 401
reset no-token: 401
```

Then delete the probe directory: `rm -rf backend/cmd/rbacprobe`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/server.go
git commit -m "feat(auth): enforce RBAC on all routes (admin/user/guest)"
```

---

### Task 5: Frontend API client — token plumbing + auth/users endpoints

**Files:**
- Modify: `src/api/client.js`

**Interfaces:**
- Consumes: backend routes from Tasks 3–4.
- Produces (used by Tasks 6–8):
  - `export function getToken(): string`
  - `api.login(username, password) → {token, user:{username, role}}`
  - `api.me() → {username, role}`
  - `api.changePassword(oldP, newP)`
  - `api.listUsers() / api.createUser({username,password,role}) / api.updateUser(id, patch) / api.deleteUser(id)`
  - All existing `api.*` calls automatically send `Authorization: Bearer`; SSE subscribes with `?token=`.

There is no JS test runner in this repo; verification = `npm run lint` + `npm run build` + manual curl parity in Task 9. (TDD deviation justified: repo has no frontend test harness; adding one is out of scope.)

- [ ] **Step 1: Add token storage + auth headers**

In `src/api/client.js`, right after the `BASE` constant, add:

```js
const TOKEN_KEY = 'kroomprint_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

function authHeaders(extra = {}) {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}`, ...extra } : extra
}
```

Change the `request` helper's header line from:

```js
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
```

to:

```js
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
```

- [ ] **Step 2: Attach headers to the two raw-fetch calls**

In `convertForPreview`, after `method: 'POST',` add:

```js
        headers: authHeaders(),
```

In `createJob`'s multipart branch, after `method: 'POST',` add the same line.

- [ ] **Step 3: Token-aware SSE**

Replace in `subscribeEvents`:

```js
      const es = new EventSource(`${BASE}/api/events`)
```

with:

```js
      const t = encodeURIComponent(getToken())
      const es = new EventSource(`${BASE}/api/events${t ? `?token=${t}` : ''}`)
```

- [ ] **Step 4: Append auth + users endpoints**

Before the closing `}` of the `api` object, add:

```js
  // ── Auth & Users ──
  login: async (username, password) => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setToken(res.token || '')
    return res
  },
  me: () => request('/api/auth/me'),
  changePassword: (oldPassword, newPassword) =>
    request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }),
  listUsers: () => request('/api/users'),
  createUser: (payload) => request('/api/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id, patch) => request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: lint clean (or pre-existing warnings only), vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/api/client.js
git commit -m "feat(ui): bearer-token plumbing + auth/users API endpoints"
```

---

### Task 6: AuthProvider, real LoginPage, App shell gating, logout

**Files:**
- Create: `src/context/AuthContext.jsx`
- Rewrite: `src/components/pages/LoginPage.jsx`
- Rewrite: `src/App.jsx`
- Modify: `src/components/TopBar.jsx` — wire logout button + username display (read file first; insertion snippet provided)

**Interfaces:**
- Consumes: Task 5 client exports.
- Produces (used by Tasks 7–8):
  - `useAuth() → { user: {username, role}|null, login(u,p), logout(), has(...roles), isAdmin, isStaff }`
  - `<Only roles={['admin']}>{children}</Only>` conditional renderer (defined in AuthContext.jsx)

- [ ] **Step 1: Create `src/context/AuthContext.jsx`**

```jsx
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { api, setToken } from '../api/client'

const AUTH_KEY = 'kroomprint_auth'
const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadPersisted())

  const login = useCallback(async (username, password) => {
    const res = await api.login(username, password)
    localStorage.setItem(AUTH_KEY, JSON.stringify(res.user))
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(() => {
    setToken('')
    localStorage.removeItem(AUTH_KEY)
    localStorage.removeItem('kroomprint_session')
    localStorage.removeItem('kroomprint_page')
    setUser(null)
  }, [])

  const has = useCallback((...roles) => {
    if (!user) return false
    if (roles.length === 0) return true
    return roles.includes(user.role)
  }, [user])

  const value = useMemo(() => ({
    user,
    login,
    logout,
    has,
    isAdmin: has('admin'),
    isStaff: has('admin', 'user'),
  }), [user, login, logout, has])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Renders children only when the signed-in role is included in roles. */
export function Only({ roles, children }) {
  const { has } = useAuth()
  return has(...roles) ? children : null
}
```

- [ ] **Step 2: Rewrite `src/components/pages/LoginPage.jsx`**

Keep the existing decorative markup/design (lines 31–145 of the current file) and replace ONLY the logic head + form fields: swap `email` state for `username`, call `useAuth().login`, remove the fake `setTimeout`. The top of the file becomes:

```jsx
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useApp } from '../../context/AppContext'
import { IconPrinter, IconWifi, IconArrowRight } from '../ui/icons'

/**
 * Login screen — KroomPrint branding, Bugster design language.
 */
export default function LoginPage() {
  const { toast } = useApp()
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password.trim()) {
      setError('Please enter your username and password.')
      return
    }
    setLoading(true)
    try {
      const user = await login(username.trim(), password)
      toast(`Welcome back, ${user.username}!`, 'success')
    } catch (err) {
      setError(err.message || 'Sign-in failed.')
    } finally {
      setLoading(false)
    }
  }
```

In the form body, replace the Email `<label>` block with:

```jsx
            <label className="flex flex-col gap-1.5">
              <span className="font-figtree text-[13px] font-medium text-dark-black-900">Username</span>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] px-4 py-3 font-figtree text-[14.5px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
              />
            </label>
```

Bind the Password input's `onChange` to `setPassword(e.target.value)` (it already is), and delete the fake "Forgot password?" demo-toast button plus the `onLogin` prop usage (the provider re-render handles the screen switch). Everything below the submit button (wifi hint + footer) stays untouched.

NOTE: `useApp()` still works here because `ToastStack`/`AppProvider` remain mounted on the login screen (see Step 3).

- [ ] **Step 3: Rewrite `src/App.jsx`**

```jsx
import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider } from './context/AppContext'
import ErrorBoundary from './components/ui/ErrorBoundary'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import ToastStack from './components/ui/Toast'
import LoginPage from './components/pages/LoginPage'
import Dashboard from './components/pages/Dashboard'
import PrintPage from './components/pages/PrintPage'
import PrintersPage from './components/pages/PrintersPage'
import QueuePage from './components/pages/QueuePage'
import HistoryPage from './components/pages/HistoryPage'
import SettingsPage from './components/pages/SettingsPage'
import UsersPage from './components/pages/UsersPage'

function Shell() {
  const { user, has, logout } = useAuth()
  const [page, setPage] = useState(() => localStorage.getItem('kroomprint_page') || 'dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const allowedPages = {
    dashboard: true,
    print: has('admin', 'user'),
    printers: true,
    queue: true,
    history: true,
    settings: true,
    users: has('admin'),
  }
  const effectivePage = allowedPages[page] ? page : 'dashboard'

  const handleNavigate = (p) => {
    setPage(p)
    localStorage.setItem('kroomprint_page', p)
  }

  const pages = {
    dashboard: <Dashboard onNavigate={handleNavigate} />,
    print: <PrintPage onNavigate={handleNavigate} />,
    printers: <PrintersPage />,
    queue: <QueuePage />,
    history: <HistoryPage />,
    settings: <SettingsPage />,
    users: <UsersPage />,
  }

  return (
    <div className="h-screen flex bg-kroom-noise overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block h-full">
        <Sidebar current={effectivePage} onNavigate={handleNavigate} />
      </div>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-dark-black-900/40 backdrop-blur-[2px] lg:hidden" onClick={() => setSidebarOpen(false)} />
          <div className="fixed left-0 top-0 bottom-0 z-[70] lg:hidden modal-in">
            <Sidebar current={effectivePage} onNavigate={(p) => { handleNavigate(p); setSidebarOpen(false) }} />
          </div>
        </>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <TopBar
          onNavigate={handleNavigate}
          onLogout={logout}
          onMenu={() => setSidebarOpen(true)}
          user={user}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto px-6 md:px-8 py-7 md:py-9">{pages[effectivePage]}</div>
        </main>
      </div>

      <ToastStack />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  )
}

function AuthenticatedApp() {
  const { user } = useAuth()

  if (!user) {
    return (
      <>
        {/* AppProvider is mounted so LoginPage can toast; its boot fetches are
            harmless while logged out — they fail quietly against 401s. */}
        <LoginPage />
        <ToastStack />
      </>
    )
  }

  return (
    <AppProvider>
      <ErrorBoundary>
        <Shell />
      </ErrorBoundary>
      <ToastStack />
    </AppProvider>
  )
}
```

Wait — contradiction flagged: mounting `AppProvider` while logged out makes its boot() fire 401 requests. Fix: do NOT mount AppProvider on the login screen. LoginPage needs toasts though. Resolution: give LoginPage local error display only (it already has `error` state) and drop `useApp`/toast usage there. Final composition:

```jsx
function AuthenticatedApp() {
  const { user } = useAuth()
  if (!user) return <LoginPage />
  return (
    <AppProvider>
      <ErrorBoundary>
        <Shell />
      </ErrorBoundary>
      <ToastStack />
    </AppProvider>
  )
}
```

…and in LoginPage remove `const { toast } = useApp()` plus its import; replace the success `toast(...)` call with `setError('')` no-op removal — simply keep the try/catch and let the provider remount render the shell (success feedback = entering the app). Delete the ToastStack fragment from the logged-out branch.

Apply BOTH corrections when writing the file: the first `Shell` code block stands as-is; `App()`/`AuthenticatedApp()` use the corrected version; LoginPage drops `useApp`.

Additionally, `LoginPage` previously received `onLogin` — ensure no leftover references remain.

- [ ] **Step 4: TopBar logout + identity**

Read `src/components/TopBar.jsx` fully first (`cat src/components/TopBar.jsx`). Then:
1. Accept the new props in the component signature: `export default function TopBar({ onNavigate, onLogout, onMenu, user })` (merge with however existing destructure looks — keep all existing props).
2. Inside the header's right-hand controls area (wherever icon buttons live), add before them:

```jsx
        <div className="hidden sm:flex items-center gap-2 mr-1">
          <div className="w-8 h-8 rounded-[10px] bg-lime-300 border border-dark-black-900 flex items-center justify-center font-bold text-[11px] text-dark-black-900 uppercase">
            {(user?.username || '?').slice(0, 2)}
          </div>
          <span className="font-figtree text-[13px] font-medium text-dark-black-900">{user?.username}</span>
          <button
            onClick={onLogout}
            title="Sign out"
            className="ml-1 px-2.5 py-1.5 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-err-100 transition-colors font-figtree text-[12px] font-semibold cursor-pointer"
          >
            Logout
          </button>
        </div>
```

If TopBar lacks a clearly grouped right side, place the block immediately before the mobile menu button.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: pass.

Manual smoke (dev servers): `cd backend && go run . &` with env `KROOM_ADDR=:8088 KROOM_DB=/tmp/kp-dev.db` then `npm run dev`; sign in admin/admin123; confirm shell loads, logout returns to login, wrong password shows inline error.

- [ ] **Step 6: Commit**

```bash
git add src/context/AuthContext.jsx src/components/pages/LoginPage.jsx src/App.jsx src/components/TopBar.jsx
git commit -m "feat(ui): real login flow, AuthProvider, role-aware app shell + logout"
```

---

### Task 7: Role-gated navigation & page actions

**Files:**
- Rewrite: `src/components/Sidebar.jsx`
- Modify: `src/components/pages/PrintPage.jsx`, `src/components/pages/PrintersPage.jsx`, `src/components/pages/QueuePage.jsx`, `src/components/pages/HistoryPage.jsx`, `src/components/pages/SettingsPage.jsx`

**Interfaces:**
- Consumes: `useAuth`, `Only` from AuthContext (Task 6).
- Produces: guests see read-only surfaces; staff see print actions; admins see everything incl. Users nav.

- [ ] **Step 1: Rewrite `src/components/Sidebar.jsx`**

Full replacement:

```jsx
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/**
 * Sidebar navigation with the Bugster design language, filtered by role.
 */
const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', roles: null },
  { id: 'print', label: 'Print', icon: 'upload', roles: ['admin', 'user'] },
  { id: 'printers', label: 'Printers', icon: 'printer', roles: null },
  { id: 'queue', label: 'Queue', icon: 'queue', roles: null },
  { id: 'history', label: 'History', icon: 'history', roles: null },
  { id: 'settings', label: 'Settings', icon: 'gear', roles: null },
  { id: 'users', label: 'Users', icon: 'history', roles: ['admin'] },
]

import {
  IconGear, IconHistory, IconHome, IconPrinter, IconQueue, IconUpload,
} from './ui/icons'

const ROLE_LABEL = { admin: 'Administrator', user: 'User', guest: 'Guest (read-only)' }

export default function Sidebar({ current, onNavigate, collapsed = false }) {
  const { queueCount, activeCount } = useApp()
  const { user, has, logout } = useAuth()

  const icons = { home: IconHome, upload: IconUpload, printer: IconPrinter, queue: IconQueue, history: IconHistory, gear: IconGear }
  const visible = navItems.filter((item) => !item.roles || has(...item.roles))
  const initials = (user?.username || '??').slice(0, 2).toUpperCase()

  return (
    <aside
      className={`hidden md:flex flex-col shrink-0 h-full border-r-2 border-dark-black-900 bg-vanilla-200 transition-all duration-300 ${
        collapsed ? 'w-[76px]' : 'w-[248px]'
      }`}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 h-[76px] border-b-2 border-dark-black-900 shrink-0">
        <div className="w-10 h-10 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center relative shrink-0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#383838" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9V3h12v6" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          <span className="absolute -top-[5px] -right-[5px] w-[10px] h-[10px] bg-sky-blue-500 border border-dark-black-900 rounded-[2px]" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-figtree font-bold text-[19px] text-dark-black-900 tracking-tight">KroomPrint</div>
            <div className="font-geist text-[10.5px] text-dark-black-900/50 uppercase tracking-widest">Wireless Print</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-5 px-3 flex flex-col gap-1.5 overflow-y-auto">
        {visible.map((item) => {
          const Icon = icons[item.icon]
          const active = current === item.id
          const badge = item.id === 'queue' ? queueCount : item.id === 'printers' ? activeCount : null
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`relative flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] border transition-all duration-200 font-figtree text-[14.5px] font-medium cursor-pointer ${
                active
                  ? 'bg-dark-black-900 text-vanilla-100 border-dark-black-900'
                  : 'border-transparent text-dark-black-900/70 hover:bg-vanilla-300/60 hover:border-dark-black-900/20'
              }`}
              title={collapsed ? item.label : undefined}
            >
              {active && (
                <span className="absolute -left-[4px] top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-[2px] bg-lime-300 border border-dark-black-900" />
              )}
              <Icon size={20} className="shrink-0" />
              {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
              {!collapsed && badge > 0 && (
                <span
                  className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold font-geist flex items-center justify-center border ${
                    active ? 'bg-lime-300 text-dark-black-900 border-dark-black-900' : 'bg-vanilla-100 text-dark-black-900 border-dark-black-900'
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* User */}
      <div className="border-t-2 border-dark-black-900 p-3 flex flex-col gap-2">
        <div className={`flex items-center gap-3 rounded-[12px] border border-dark-black-900 bg-vanilla-100 p-3 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-9 h-9 rounded-[10px] bg-lime-300 border border-dark-black-900 flex items-center justify-center font-bold text-[13px] text-dark-black-900 shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="font-figtree font-semibold text-[13.5px] text-dark-black-900 truncate">{user?.username}</div>
              <div className="font-geist text-[10.5px] text-dark-black-900/50 truncate">{ROLE_LABEL[user?.role] || user?.role}</div>
            </div>
          )}
        </div>
        <button
          onClick={logout}
          title="Sign out"
          className={`rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-err-100 transition-colors font-figtree text-[13px] font-semibold text-dark-black-900 cursor-pointer ${collapsed ? 'py-2' : 'py-2'}`}
        >
          {collapsed ? '⎋' : 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
```

(The removed `printers` variable was unused after refactor — `activeCount` covers the badge.)

- [ ] **Step 2: Guest banner + submit lock on PrintPage**

In `src/components/pages/PrintPage.jsx`: import `{ useAuth } from '../../context/AuthContext'`; at top of the component body add:

```jsx
  const { isStaff } = useAuth()
```

Wrap `handleSubmit`'s first lines with the guard:

```jsx
  const handleSubmit = () => {
    if (!isStaff) {
      toast('Guest accounts cannot send print jobs.', 'error')
      return
    }
    if (!file) {
```

And directly above the dropzone's opening JSX tag, render the read-only notice:

```jsx
      {!isStaff && (
        <div className="mb-4 p-3.5 rounded-[12px] border-2 border-dark-black-900/30 bg-vanilla-100 font-figtree text-[13px] text-dark-black-900/70">
          You are signed in as <b>Guest</b> — viewing is allowed, printing is disabled.
        </div>
      )}
```

Locate the exact dropzone container by searching `onDrop={onFileDrop}` and insert the banner as its preceding sibling.

- [ ] **Step 3: Hide admin-only printer controls on PrintersPage**

In `src/components/pages/PrintersPage.jsx`: `import { Only } from '../../context/AuthContext'`. Wrap each admin-only control (buttons/labels for Add Printer, Delete, Rename, Pause/Resume, Enable/Disable, Set Default, Refresh, Clean Head, Nozzle Check, Discovery Scan/Add) individually:

```jsx
<Only roles={['admin']}>
  {/* existing control JSX moved inside */}
</Only>
```

Do this by reading the file and applying the wrapper around each identified control; leave Status/Health displays unwrapped. Verification: as guest, no mutation controls visible; as admin, all present.

- [ ] **Step 4: Queue & History action gating**

`QueuePage.jsx` / `HistoryPage.jsx`: import `Only`; wrap per-job action buttons (cancel/pause/resume/retry/purge/reorder handles) with `<Only roles={['admin','user']}>…</Only>`; History "Clear History" with `<Only roles={['admin']}>…</Only>`.

- [ ] **Step 5: SettingsPage read-only for non-admins**

`SettingsPage.jsx`: `import { useAuth } from '../../context/AuthContext'`; add `const { isAdmin } = useAuth()`; wrap the Save/Reset buttons with `<Only roles={['admin']}>…</Only>` and add atop the page:

```jsx
{!isAdmin && (
  <div className="mb-4 p-3.5 rounded-[12px] border-2 border-dark-black-900/30 bg-vanilla-100 font-figtree text-[13px] text-dark-black-900/70">
    Settings are read-only for your role. Contact an administrator to change them.
  </div>
)}
```

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar.jsx src/components/pages/
git commit -m "feat(ui): role-gated navigation and page-level actions"
```

---

### Task 8: Admin UsersPage

**Files:**
- Create: `src/components/pages/UsersPage.jsx`
- Modify: none further (route `users` already wired in App.jsx Task 6)

**Interfaces:**
- Consumes: `api.listUsers/createUser/updateUser/deleteUser` (Task 5), `useApp().toast`, `Only` not needed (page itself admin-only via shell gating).

- [ ] **Step 1: Create the page**

```jsx
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'

const ROLES = ['admin', 'user', 'guest']

export default function UsersPage() {
  const { toast } = useApp()
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'guest' })
  const [showForm, setShowForm] = useState(false)

  const reload = useCallback(async () => {
    try {
      setUsers(await api.listUsers())
    } catch (e) {
      toast(e.message, 'error')
    }
  }, [toast])

  useEffect(() => { reload() }, [reload])

  const createUser = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.createUser(form)
      toast(`User "${form.username}" created`, 'success')
      setForm({ username: '', password: '', role: 'guest' })
      setShowForm(false)
      await reload()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const setRole = async (u, role) => {
    try {
      await api.updateUser(u.id, { role })
      toast(`${u.username} is now ${role}`, 'success')
      await reload()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const resetPassword = async (u) => {
    const pw = window.prompt(`New password for ${u.username} (min 6 chars):`)
    if (!pw) return
    try {
      await api.updateUser(u.id, { password: pw })
      toast(`Password updated for ${u.username}`, 'success')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const removeUser = async (u) => {
    if (!window.confirm(`Delete account "${u.username}"?`)) return
    try {
      await api.deleteUser(u.id)
      toast(`Deleted ${u.username}`, 'success')
      await reload()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-figtree font-bold text-[26px] text-dark-black-900">Users &amp; Roles</h1>
          <p className="font-figtree text-dark-black-900/55 text-[14px] mt-1">
            admin = full control · user = print &amp; queue · guest = read-only
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-5 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-500 font-figtree font-bold text-[14px] cursor-pointer"
        >
          {showForm ? 'Close' : '+ Add User'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createUser} className="mb-6 p-5 rounded-[16px] border-2 border-dark-black-900 bg-vanilla-200 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="font-figtree text-[12px] font-medium">Username</span>
            <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-2 font-figtree text-[14px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-figtree text-[12px] font-medium">Password (min 6)</span>
            <input required minLength={6} type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-2 font-figtree text-[14px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-figtree text-[12px] font-medium">Role</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-2 font-figtree text-[14px]">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy}
            className="px-4 py-2.5 rounded-[10px] border-2 border-dark-black-900 bg-dark-black-900 text-vanilla-100 font-figtree font-bold text-[14px] cursor-pointer disabled:opacity-60">
            Create
          </button>
        </form>
      )}

      <div className="rounded-[16px] border-2 border-dark-black-900 bg-vanilla-200 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b-2 border-dark-black-900 bg-vanilla-300/60">
              <th className="px-5 py-3 font-figtree text-[12.5px] uppercase tracking-wide">User</th>
              <th className="px-5 py-3 font-figtree text-[12.5px] uppercase tracking-wide">Role</th>
              <th className="px-5 py-3 font-figtree text-[12.5px] uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-dark-black-900/15 last:border-0">
                <td className="px-5 py-3 font-figtree text-[14.5px] font-medium">
                  {u.username}{me?.username === u.username && <span className="ml-2 text-[11px] font-geist text-dark-black-900/50">(you)</span>}
                </td>
                <td className="px-5 py-3">
                  <select
                    value={u.role}
                    onChange={(e) => setRole(u, e.target.value)}
                    disabled={u.username === 'admin'}
                    className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[8px] px-2 py-1 font-figtree text-[13px] disabled:opacity-50"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-5 py-3 flex gap-2">
                  <button onClick={() => resetPassword(u)}
                    className="px-3 py-1.5 rounded-[8px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 font-figtree text-[12.5px] font-semibold cursor-pointer">
                    Reset Password
                  </button>
                  <button
                    onClick={() => removeUser(u)}
                    disabled={u.username === 'admin' || me?.username === u.username}
                    className="px-3 py-1.5 rounded-[8px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-err-100 font-figtree text-[12.5px] font-semibold cursor-pointer disabled:opacity-40"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} className="px-5 py-6 font-figtree text-[14px] text-dark-black-900/50">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/pages/UsersPage.jsx
git commit -m "feat(ui): admin Users management page (create/role/reset/delete)"
```

---

### Task 9: Build frontend, deploy both tiers, E2E verification on amba

**Files:** none new — operational task.

- [ ] **Step 1: Backend binary rebuild (NAS)**

Run: `cd /volume1/web/Nouvem/printer-wireless/backend && go build -buildvcs=false -o kroomprint-backend . && chmod 755 kroomprint-backend`
Expected: silent success; binary timestamp updated.

- [ ] **Step 2: Deploy frontend + restart API on amba**

SSH to amba (password `kolab777`, user `amba`) and run:

```bash
pm2 restart kroomprint-api
sleep 3
curl -s --max-time 5 http://localhost:8088/api/health; echo
```

Expected: `{"cups":true,"ok":true,...}`.

Then build the frontend on amba (Node 20 via nvm):

```bash
bash /mnt/web/Nouvem/printer-wireless/deploy.sh
```

Expected: script completes with "✓ Deploy selesai!".

- [ ] **Step 3: E2E curl matrix (against live :8088)**

```bash
B=http://localhost:8088
echo "-- unauth printers (expect 401):"; curl -s -o /dev/null -w "%{http_code}\n" $B/api/printers
TOK=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "-- login token len:"; echo -n "$TOK" | wc -c
echo "-- authed printers (expect 200):"; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOK" $B/api/printers
echo "-- me:"; curl -s -H "Authorization: Bearer $TOK" $B/api/auth/me; echo
GT=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"username":"x","password":"x"}' -o /dev/null -w "%{http_code}")
echo "-- bad login (expect 401):"; echo $GT
UTOK=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
curl -s -X POST $B/api/users -H "Authorization: Bearer $UTOK" -H 'Content-Type: application/json' -d '{"username":"tamu","password":"tamu123","role":"guest"}'; echo
GTOK=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"username":"tamu","password":"tamu123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "-- guest job create (expect 403):"; curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $GTOK" $B/api/jobs
echo "-- guest users list (expect 403):"; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $GTOK" $B/api/users
echo "-- guest printers view (expect 200):"; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $GTOK" $B/api/printers
```

Expected sequence: `401`, token ≥ 100 chars, `200`, `{"username":"admin","role":"admin"}`, `401`, guest created, `403`, `403`, `200`.

- [ ] **Step 4: Browser smoke**

Visit `http://100.90.80.85:5174`: login form appears (no more fake autofill), sign in as admin → full nav incl. Users; create guest, sign out, sign in as guest → no Print nav item, Printers page read-only, no Users nav; sign out → back to login.

- [ ] **Step 5: Final commit (if any stray diffs)**

```bash
git status --short
# only proceed when clean; otherwise stage intentional leftovers with a chore commit
```

---

## Rollback Plan

Backend revert = redeploy previous binary (`git checkout HEAD~N -- backend/ && go build`), restart PM2; DB keeps `users` table harmlessly (old binary ignores it). Frontend rollback = `deploy.sh` after reverting `src/`.
