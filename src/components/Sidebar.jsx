import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'

/**
 * Sidebar navigation with the Bugster design language, filtered by role.
 */
const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', roles: null },
  { id: 'print', label: 'Print', icon: 'upload', roles: null },
  { id: 'printers', label: 'Printers', icon: 'printer', roles: null },
  { id: 'queue', label: 'Queue', icon: 'queue', roles: null },
  { id: 'history', label: 'History', icon: 'history', roles: null },
  { id: 'settings', label: 'Settings', icon: 'gear', roles: null },
  { id: 'users', label: 'Users', icon: 'history', roles: ['admin'] },
]

import {
  IconGear, IconHistory, IconHome, IconPrinter, IconQueue, IconUpload,
  IconCrown, IconUser, IconEye, IconX,
} from './ui/icons'

const ROLE_META = {
  admin: { label: 'Administrator', badge: 'Admin', icon: IconCrown, bg: 'bg-lime-300', border: 'border-dark-black-900' },
  user: { label: 'Standard User', badge: 'User', icon: IconUser, bg: 'bg-sky-blue-100', border: 'border-dark-black-900' },
  guest: { label: 'Guest (Read-only)', badge: 'Guest', icon: IconEye, bg: 'bg-vanilla-300', border: 'border-dark-black-900' },
}

export default function Sidebar({ current, onNavigate, collapsed = false, isMobile = false, onClose }) {
  const { queueCount, activeCount } = useApp()
  const { user, has, logout, isAuthenticated, openLoginModal } = useAuth()

  const icons = { home: IconHome, upload: IconUpload, printer: IconPrinter, queue: IconQueue, history: IconHistory, gear: IconGear }
  const visible = navItems.filter((item) => !item.roles || has(...item.roles))
  const roleMeta = ROLE_META[user?.role] || ROLE_META.guest
  const RoleIcon = roleMeta.icon

  return (
    <aside
      className={`flex flex-col shrink-0 h-full border-r-2 border-dark-black-900 bg-vanilla-200 transition-all duration-300 ${
        isMobile ? 'w-[280px]' : collapsed ? 'w-[76px]' : 'w-[260px]'
      }`}
    >
      {/* Brand */}
      <div className="flex items-center justify-between px-5 h-[76px] border-b-2 border-dark-black-900 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center relative shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#383838" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9V3h12v6" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span className="absolute -top-[5px] -right-[5px] w-[10px] h-[10px] bg-sky-blue-500 border border-dark-black-900 rounded-[2px]" />
          </div>
          {(!collapsed || isMobile) && (
            <div className="leading-tight truncate">
              <div className="font-figtree font-bold text-[19px] text-dark-black-900 tracking-tight">KroomPrint</div>
              <div className="font-geist text-[10.5px] text-dark-black-900/50 uppercase tracking-widest">Wireless Print</div>
            </div>
          )}
        </div>
        {isMobile && onClose && (
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-[8px] border-2 border-dark-black-900 bg-vanilla-100 flex items-center justify-center text-dark-black-900 hover:bg-err-100 cursor-pointer transition-colors"
            aria-label="Close menu"
          >
            <IconX size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-5 px-3 flex flex-col gap-1.5 overflow-y-auto">
        {visible.map((item) => {
          const Icon = icons[item.icon]
          const active = current === item.id
          const badge = item.id === 'queue' ? queueCount : item.id === 'printers' ? activeCount : null
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`relative flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] border transition-all duration-150 font-figtree text-[14.5px] font-medium cursor-pointer ${
                active
                  ? 'bg-dark-black-900 text-vanilla-100 border-dark-black-900 shadow-sm'
                  : 'border-transparent text-dark-black-900/70 hover:bg-vanilla-300/60 hover:border-dark-black-900/20'
              }`}
              title={collapsed && !isMobile ? item.label : undefined}
            >
              {active && (
                <span className="absolute -left-[4px] top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-[2px] bg-lime-300 border border-dark-black-900" />
              )}
              <Icon size={20} className="shrink-0" />
              {(!collapsed || isMobile) && <span className="flex-1 text-left">{item.label}</span>}
              {(!collapsed || isMobile) && badge > 0 && (
                <span
                  className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold font-geist flex items-center justify-center border ${
                    active ? 'bg-lime-300 text-dark-black-900 border-dark-black-900' : 'bg-vanilla-100 text-dark-black-900 border-dark-black-900'
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* User Section */}
      <div className="border-t-2 border-dark-black-900 p-3 flex flex-col gap-2">
        <div className={`flex items-center gap-3 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 p-3 ${collapsed && !isMobile ? 'justify-center' : ''}`}>
          <div className={`w-10 h-10 rounded-[11px] ${roleMeta.bg} border-2 border-dark-black-900 flex items-center justify-center text-dark-black-900 shrink-0 relative shadow-xs`}>
            <RoleIcon size={20} />
          </div>
          {(!collapsed || isMobile) && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-figtree font-bold text-[14px] text-dark-black-900 truncate">
                {isAuthenticated ? user?.username : 'Guest User'}
              </div>
              <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-[5px] border border-dark-black-900/30 bg-vanilla-200 text-[10.5px] font-geist font-semibold uppercase tracking-wider text-dark-black-900/80">
                <RoleIcon size={11} className="shrink-0" />
                <span>{roleMeta.badge}</span>
              </div>
            </div>
          )}
        </div>
        {isAuthenticated ? (
          <button
            onClick={logout}
            title="Sign out"
            className="rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-err-100 hover:text-err-500 transition-colors font-figtree text-[13px] font-semibold text-dark-black-900 cursor-pointer py-2 text-center"
          >
            {collapsed && !isMobile ? 'Exit' : 'Sign out'}
          </button>
        ) : (
          <button
            onClick={() => openLoginModal('Sign in to access your wireless printers and print jobs.')}
            title="Sign in"
            className="rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-400 font-figtree text-[13px] font-bold text-dark-black-900 cursor-pointer py-2 text-center shadow-xs transition-all flex items-center justify-center gap-1.5"
          >
            <RoleIcon size={14} />
            {collapsed && !isMobile ? 'Login' : 'Sign in'}
          </button>
        )}
      </div>
    </aside>
  )
}
