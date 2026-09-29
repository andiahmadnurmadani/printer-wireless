import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken } from '../api/client'

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

  const logout = useCallback(() => {
    setToken('')
    try {
      localStorage.removeItem(AUTH_KEY)
      localStorage.removeItem('kroomprint_session')
      localStorage.removeItem('kroomprint_page')
    } catch {}
    setUser(GUEST_USER)
  }, [])

  const login = useCallback(async (username, password) => {
    const res = await api.login(username, password)
    localStorage.setItem(AUTH_KEY, JSON.stringify(res.user))
    setUser(res.user)
    return res.user
  }, [])

  // Auto-verify token with backend on boot
  useEffect(() => {
    const token = getToken()
    if (!token) {
      if (user?.role !== 'guest') setUser(GUEST_USER)
      return
    }
    let active = true
    api.me()
      .then((res) => {
        if (!active) return
        if (res?.user) {
          localStorage.setItem(AUTH_KEY, JSON.stringify(res.user))
          setUser(res.user)
        }
      })
      .catch((err) => {
        if (!active) return
        console.warn('Session verification failed on startup:', err)
        logout()
      })
    return () => {
      active = false
    }
  }, [])

  // Listen for 401 session expiry events dispatched by client.js
  useEffect(() => {
    const handleExpired = () => {
      logout()
      openLoginModal('Sesi login Anda telah kedaluwarsa. Silakan masuk kembali.')
    }
    window.addEventListener('kroomprint:auth-expired', handleExpired)
    return () => {
      window.removeEventListener('kroomprint:auth-expired', handleExpired)
    }
  }, [logout, openLoginModal])

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
