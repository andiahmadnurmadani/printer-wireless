package api

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"kroomprint/backend/internal/config"
	"kroomprint/backend/internal/store"
)

func testLogger() *log.Logger { return log.New(io.Discard, "[test] ", 0) }

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
	if _, err := verifyToken(sec, good[:len(good)-2]+"xx"); err == nil {
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
		switch {
		case tc.name == "bad token":
			req.Header.Set("Authorization", "Bearer "+tc.token)
		case tc.token != "" && tc.name == "query token ok":
			req.URL.RawQuery = "token=" + tc.token
		case tc.token != "":
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Errorf("%s: got %d want %d", tc.name, w.Code, tc.status)
		}
	}
}
