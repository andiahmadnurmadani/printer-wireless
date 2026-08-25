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

  const handleLogout = () => {
    logout()
    setPage('dashboard')
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
          onLogout={handleLogout}
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

  // Logged out: render only the login screen. AppProvider (which boots API
  // data and opens SSE) mounts exclusively for authenticated sessions.
  if (!user) {
    return <LoginPage />
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
