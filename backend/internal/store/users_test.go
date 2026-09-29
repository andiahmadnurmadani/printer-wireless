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
	if len(users) != 1 || users[0].Username != "Kolab" || users[0].Role != "admin" {
		t.Fatalf("seeded users = %+v", users)
	}
	_, hash, role, err := st.GetUserByUsername("Kolab")
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
