import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { api, setToken } from '../api/client'

const AUTH_KEY = 'kroomprint_auth'
const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

const GUEST_USER = { id: 'guest', username: 'Guest', role: 'guest' }

function loadPersisted() {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadPersisted() || GUEST_USER)
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [loginModalMsg, setLoginModalMsg] = useState('')

  const openLoginModal = useCallback((msg = '') => {
    setLoginModalMsg(msg)
    setLoginModalOpen(true)
  }, [])

  const closeLoginModal = useCallback(() => {
    setLoginModalOpen(false)
    setLoginModalMsg('')
  }, [])

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
    setUser(GUEST_USER)
  }, [])

  const isAuthenticated = Boolean(user && user.role !== 'guest' && user.id !== 'guest')

  const has = useCallback((...roles) => {
    if (roles.length === 0) return true
    if (!isAuthenticated) {
      return roles.includes('guest')
    }
    return roles.includes(user.role)
  }, [user, isAuthenticated])

  const value = useMemo(() => ({
    user,
    isAuthenticated,
    isGuest: !isAuthenticated,
    loginModalOpen,
    loginModalMsg,
    openLoginModal,
    closeLoginModal,
    login,
    logout,
    has,
    isAdmin: has('admin'),
    isStaff: has('admin', 'user'),
  }), [user, isAuthenticated, loginModalOpen, loginModalMsg, openLoginModal, closeLoginModal, login, logout, has])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Renders children only when the signed-in role is included in roles. */
export function Only({ roles, children }) {
  const { has } = useAuth()
  return has(...roles) ? children : null
}
