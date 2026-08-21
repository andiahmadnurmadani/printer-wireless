import { useState } from 'react'
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

function Shell() {
  const [page, setPage] = useState(() => localStorage.getItem('kroomprint_page') || 'dashboard')
  const [loggedIn, setLoggedIn] = useState(() => localStorage.getItem('kroomprint_session') === '1')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogin = () => {
    localStorage.setItem('kroomprint_session', '1')
    setLoggedIn(true)
  }
  const handleLogout = () => {
    localStorage.removeItem('kroomprint_session')
    localStorage.removeItem('kroomprint_page')
    setLoggedIn(false)
    setPage('dashboard')
  }
  const handleNavigate = (p) => {
    setPage(p)
    localStorage.setItem('kroomprint_page', p)
  }

  if (!loggedIn) {
    return (
      <>
        <LoginPage onLogin={handleLogin} />
        <ToastStack />
      </>
    )
  }

  const pages = {
    dashboard: <Dashboard onNavigate={handleNavigate} />,
    print: <PrintPage />,
    printers: <PrintersPage />,
    queue: <QueuePage />,
    history: <HistoryPage />,
    settings: <SettingsPage />,
  }

  return (
    <div className="h-screen flex bg-kroom-noise overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block h-full">
        <Sidebar current={page} onNavigate={handleNavigate} />
      </div>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-dark-black-900/40 backdrop-blur-[2px] lg:hidden" onClick={() => setSidebarOpen(false)} />
          <div className="fixed left-0 top-0 bottom-0 z-[70] lg:hidden modal-in">
            <Sidebar current={page} onNavigate={(p) => { handleNavigate(p); setSidebarOpen(false) }} />
          </div>
        </>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <TopBar onNavigate={handleNavigate} onLogout={handleLogout} onMenu={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto px-6 md:px-8 py-7 md:py-9">{pages[page]}</div>
        </main>
      </div>

      <ToastStack />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <ErrorBoundary>
        <Shell />
      </ErrorBoundary>
    </AppProvider>
  )
}
