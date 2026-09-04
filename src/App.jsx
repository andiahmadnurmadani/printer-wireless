import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppProvider } from './context/AppContext'
import ErrorBoundary from './components/ui/ErrorBoundary'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import ToastStack from './components/ui/Toast'
import LoginModal from './components/auth/LoginModal'
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
    print: true,
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
    <div className="min-h-screen h-screen flex bg-kroom-noise overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-col h-full shrink-0">
        <Sidebar current={effectivePage} onNavigate={handleNavigate} />
      </div>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-dark-black-900/50 backdrop-blur-[3px] lg:hidden transition-opacity"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed left-0 top-0 bottom-0 z-[70] lg:hidden modal-in shadow-2xl flex flex-col h-full">
            <Sidebar
              isMobile
              current={effectivePage}
              onNavigate={(p) => {
                handleNavigate(p)
                setSidebarOpen(false)
              }}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
        <TopBar
          onNavigate={handleNavigate}
          onLogout={handleLogout}
          onMenu={() => setSidebarOpen(true)}
          user={user}
        />
        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8">
            {pages[effectivePage]}
          </div>
        </main>
      </div>

      <ToastStack />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <ErrorBoundary>
          <Shell />
          <LoginModal />
        </ErrorBoundary>
        <ToastStack />
      </AppProvider>
    </AuthProvider>
  )
}
