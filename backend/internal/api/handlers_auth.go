package api

import (
	"errors"
	"golang.org/x/crypto/bcrypt"
	"kroomprint/backend/internal/store"
	"net/http"
	"strings"
	"time"
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
	pw := strings.TrimSpace(req.Password)
	pwMatched := bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
	if !pwMatched && len(pw) > 0 {
		titlePw := strings.ToUpper(pw[:1]) + pw[1:]
		lowerPw := strings.ToLower(pw)
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(titlePw)) == nil ||
			bcrypt.CompareHashAndPassword([]byte(hash), []byte(lowerPw)) == nil {
			pwMatched = true
		}
	}
	if !pwMatched {
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
	name := c.Sub
	if users, err := s.store.ListUsers(); err == nil {
		for _, u := range users {
			if u.ID == c.Sub {
				name = u.Username
				break
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"username": name, "role": c.Role})
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
		Role     *string `json:"role,omitempty"`
		Password *string `json:"password,omitempty"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Role != nil && !store.ValidRole(*req.Role) {
		writeErr(w, http.StatusBadRequest, "invalid role")
		return
	}
	if req.Role != nil && *req.Role != "admin" {
		// Demotion must never leave zero active admins.
		if u, uerr := findUserByID(s, id); uerr == nil && u.Role == "admin" {
			if n, _ := s.store.CountUsersByRole("admin"); n <= 1 {
				writeErr(w, http.StatusConflict, "cannot demote the last admin")
				return
			}
		}
	}
	if req.Role != nil {
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
	if c, ok := s.claimsFromCtx(r); ok && c.Sub == id {
		writeErr(w, http.StatusConflict, "cannot delete your own account")
		return
	}
	target, uerr := findUserByID(s, id)
	if uerr != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	if target.Role == "admin" {
		if n, _ := s.store.CountUsersByRole("admin"); n <= 1 {
			writeErr(w, http.StatusConflict, "cannot delete the last admin")
			return
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
