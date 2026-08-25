package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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

func tokenField(body string) string {
	i := strings.Index(body, `"token":"`)
	if i < 0 {
		return ""
	}
	rest := body[i+len(`"token":"`):]
	return rest[:strings.Index(rest, `"`)]
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

	meH := s.authorize(nil, http.HandlerFunc(s.handleMe))
	w := doJSON(t, meH, "GET", "/api/auth/me", tok, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"role":"admin"`) {
		t.Fatalf("me: %d %s", w.Code, w.Body.String())
	}

	cpH := s.authorize(nil, http.HandlerFunc(s.handleChangePassword))
	w = doJSON(t, cpH, "POST", "/api/auth/change-password", tok,
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
	_, _ = s.store.CreateUser("staff", "staff123", "user")
	userTok := loginAs(t, s, "staff", "staff123")

	listGate := s.authorize([]string{"admin"}, http.HandlerFunc(s.handleListUsers))
	createGate := s.authorize([]string{"admin"}, http.HandlerFunc(s.handleCreateUser))

	if w := doJSON(t, listGate, "GET", "/api/users", userTok, ""); w.Code != 403 {
		t.Fatalf("non-admin list users: %d", w.Code)
	}

	w := doJSON(t, createGate, "POST", "/api/users", adminTok,
		`{"username":"tamu","password":"tamu123","role":"guest"}`)
	if w.Code != 200 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	list := doJSON(t, listGate, "GET", "/api/users", adminTok, "")
	if !strings.Contains(list.Body.String(), `"username":"tamu"`) {
		t.Fatalf("list missing tamu: %s", list.Body.String())
	}

	if w := doJSON(t, createGate, "POST", "/api/users", adminTok,
		`{"username":"tamu","password":"xxxxxxx","role":"user"}`); w.Code != 409 {
		t.Fatalf("dup create code=%d", w.Code)
	}

	users, _ := s.store.ListUsers()
	var adminID, uid string
	for _, u := range users {
		switch u.Username {
		case "admin":
			adminID = u.ID
		case "staff":
			uid = u.ID
		}
	}

	delGate := func() http.Handler { return s.authorize([]string{"admin"}, http.HandlerFunc(s.handleDeleteUser)) }
	req := httptest.NewRequest("DELETE", "/api/users/"+adminID, nil)
	req.SetPathValue("id", adminID)
	req.Header.Set("Authorization", "Bearer "+adminTok)
	wr := httptest.NewRecorder()
	delGate().ServeHTTP(wr, req)
	if wr.Code != 409 {
		t.Fatalf("delete last admin: %d", wr.Code)
	}

	req2 := httptest.NewRequest("DELETE", "/api/users/"+uid, nil)
	req2.SetPathValue("id", uid)
	req2.Header.Set("Authorization", "Bearer "+adminTok)
	wr2 := httptest.NewRecorder()
	delGate().ServeHTTP(wr2, req2)
	if wr2.Code != 204 {
		t.Fatalf("delete user: %d", wr2.Code)
	}
}
