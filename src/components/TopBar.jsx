import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import {
  IconSearch, IconWifi, IconChevronDown, IconLogout, IconPrinter,
  IconCrown, IconUser, IconEye, IconGear, IconUsers,
} from './ui/icons'

/**
 * Top bar — search, connection status, user menu.
 */
export default function TopBar({ onNavigate, onLogout, onMenu, user }) {
  const { printers, activeCount, jobs } = useApp()
  const { isAuthenticated, openLoginModal } = useAuth()
  const [userOpen, setUserOpen] = useState(false)
  const [q, setQ] = useState('')

  const printingCount = useMemo(() => jobs.filter((j) => j.status === 'printing').length, [jobs])

  const RoleIcon = user?.role === 'admin' ? IconCrown : user?.role === 'user' ? IconUser : IconEye
  const roleBg = user?.role === 'admin' ? 'bg-lime-300' : user?.role === 'user' ? 'bg-sky-blue-100' : 'bg-vanilla-300'
  const roleLabel = user?.role === 'admin' ? 'Admin' : user?.role === 'user' ? 'User' : 'Guest'

  const results = useMemo(() => {
    if (!q.trim()) return []
    const term = q.toLowerCase()
    const printerHits = printers
      .filter((p) => `${p.name} ${p.brand} ${p.model} ${p.address}`.toLowerCase().includes(term))
      .map((p) => ({ type: 'printer', id: p.id, label: p.name, sub: `${p.brand} ${p.model}` }))
    const jobHits = jobs
      .filter((j) => j.name.toLowerCase().includes(term))
      .map((j) => ({ type: 'job', id: j.id, label: j.name, sub: j.status }))
    return [...printerHits, ...jobHits].slice(0, 6)
  }, [q, printers, jobs])

  return (
    <header className="relative z-40 h-[72px] shrink-0 flex items-center gap-4 px-5 border-b-2 border-dark-black-900 bg-vanilla-200">
      {/* Mobile menu button */}
      <button
        onClick={onMenu}
        className="lg:hidden w-10 h-10 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 flex flex-col items-center justify-center gap-[3px] cursor-pointer"
        aria-label="Menu"
      >
        <span className="w-4 h-[2px] bg-dark-black-900" />
        <span className="w-4 h-[2px] bg-dark-black-900" />
        <span className="w-4 h-[2px] bg-dark-black-900" />
      </button>

      {/* Search */}
      <div className="relative flex-1 max-w-xl">
        <IconSearch size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-black-900/50 pointer-events-none" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search printers and jobs…"
          className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] pl-10 pr-4 py-2.5 font-figtree text-[14px] focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
        />
        {results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-vanilla-100 border-2 border-dark-black-900 rounded-[14px] shadow-xl overflow-hidden z-50">
            {results.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => {
                  onNavigate(r.type === 'printer' ? 'printers' : 'queue')
                  setQ('')
                }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-lime-300/40 transition-colors cursor-pointer text-left"
              >
                <span className="w-8 h-8 rounded-[9px] border border-dark-black-900 bg-vanilla-200 flex items-center justify-center text-dark-black-900 shrink-0">
                  {r.type === 'printer' ? <IconPrinter size={15} /> : <IconSearch size={15} />}
                </span>
                <span className="min-w-0">
                  <span className="block font-figtree font-semibold text-[13.5px] text-dark-black-900 truncate">{r.label}</span>
                  <span className="block font-figtree font-light text-dark-black-900/50 text-[12px] capitalize">{r.sub}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Status pills */}
      <div className="hidden md:flex items-center gap-2">
        <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[11px] border-2 border-dark-black-900 bg-vanilla-100 font-figtree text-[12.5px] font-medium text-dark-black-900 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-ok-500 animate-pulse" />
          {activeCount}/{printers.length} online
        </span>
        {printingCount > 0 && (
          <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[11px] border-2 border-dark-black-900 bg-lime-300 font-figtree text-[12.5px] font-medium text-dark-black-900 shadow-sm">
            <IconWifi size={14} className="text-dark-black-900/60" />
            {printingCount} printing
          </span>
        )}
      </div>

      {/* User menu / Guest Sign In button */}
      {isAuthenticated ? (
        <div className="relative">
          <button
            onClick={() => setUserOpen(!userOpen)}
            className="flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 transition-colors cursor-pointer shadow-sm"
          >
            <div
              className={`w-9 h-9 rounded-[10px] border-2 border-dark-black-900 flex items-center justify-center text-dark-black-900 ${roleBg}`}
            >
              <RoleIcon size={18} />
            </div>
            <span className="hidden sm:block text-left leading-tight">
              <span className="block font-figtree font-bold text-[13px] text-dark-black-900">{user?.username || 'User'}</span>
              <span className="flex items-center gap-1 font-geist text-[10.5px] text-dark-black-900/60 uppercase tracking-wide">
                <RoleIcon size={10} />
                <span>{roleLabel}</span>
              </span>
            </span>
            <IconChevronDown size={15} className="text-dark-black-900/60" />
          </button>

          {userOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-[240px] bg-vanilla-100 border-2 border-dark-black-900 rounded-[16px] shadow-2xl overflow-hidden z-50 modal-in">
                <div className="px-4 py-3.5 border-b-2 border-dark-black-900 bg-vanilla-200">
                  <div className="font-figtree font-bold text-[14px] text-dark-black-900">{user?.username || 'User'}</div>
                  <div className="font-geist text-[11px] text-dark-black-900/60 capitalize mt-0.5 flex items-center gap-1.5">
                    <RoleIcon size={12} />
                    <span>Role: <b>{user?.role || 'Guest'}</b></span>
                  </div>
                </div>
                <div className="p-2 flex flex-col gap-1">
                  <button
                    onClick={() => { setUserOpen(false); onNavigate('settings') }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] hover:bg-vanilla-300 font-figtree text-[13.5px] font-medium text-dark-black-900 cursor-pointer"
                  >
                    <IconGear size={15} />
                    <span>Settings &amp; Diagnostics</span>
                  </button>
                  {user?.role === 'admin' && (
                    <button
                      onClick={() => { setUserOpen(false); onNavigate('users') }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] hover:bg-lime-300 font-figtree text-[13.5px] font-medium text-dark-black-900 cursor-pointer"
                    >
                      <IconUsers size={15} />
                      <span>Manage Users</span>
                    </button>
                  )}
                  <div className="my-1 border-t border-dark-black-900/10" />
                  <button
                    onClick={() => { setUserOpen(false); onLogout() }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] hover:bg-err-100 font-figtree text-[13.5px] font-semibold text-err-500 cursor-pointer"
                  >
                    <IconLogout size={15} />
                    <span>Sign out</span>
                  </button>
                </div>
                <div className="px-4 py-2 border-t-2 border-dark-black-900 bg-vanilla-200 font-geist text-[10px] text-dark-black-900/40 uppercase tracking-widest flex items-center justify-between">
                  <span>KroomPrint</span>
                  <span>v1.0.0</span>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-[11px] border-2 border-dark-black-900/30 bg-vanilla-100 font-figtree text-[12px] text-dark-black-900/70">
            <IconEye size={14} className="text-dark-black-900/50" />
            Guest mode
          </span>
          <button
            onClick={() => openLoginModal('Sign in to access wireless printing.')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-400 font-figtree font-bold text-[13.5px] text-dark-black-900 shadow-[2px_2px_0_0_rgba(56,56,56,1)] cursor-pointer transition-all active:translate-x-0.5 active:translate-y-0.5"
          >
            <IconUser size={15} />
            <span>Sign in</span>
          </button>
        </div>
      )}
    </header>
  )
}
