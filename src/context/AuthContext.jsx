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
