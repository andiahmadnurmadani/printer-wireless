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

func (s *Server) optionalAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := bearerToken(r)
		if tok != "" {
			if sec, err := s.authSecret(); err == nil {
				if c, err := verifyToken(sec, tok); err == nil {
					r = r.WithContext(context.WithValue(r.Context(), claimsKey, c))
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) claimsFromCtx(r *http.Request) (claims, bool) {
	c, ok := r.Context().Value(claimsKey).(claims)
	return c, ok
}
