import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { IconSearch, IconWifi, IconChevronDown, IconLogout, IconPrinter } from './ui/icons'

/**
 * Top bar — search, connection status, user menu.
 */
export default function TopBar({ onNavigate, onLogout, onMenu }) {
  const { printers, activeCount, jobs, defaultPrinter, toast } = useApp()
  const [userOpen, setUserOpen] = useState(false)
  const [q, setQ] = useState('')

  const printingCount = useMemo(() => jobs.filter((j) => j.status === 'printing').length, [jobs])

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
        <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[11px] border-2 border-dark-black-900 bg-vanilla-100 font-figtree text-[12.5px] font-medium text-dark-black-900">
          <span className="w-2 h-2 rounded-full bg-ok-500 animate-pulse" />
          {activeCount}/{printers.length} online
        </span>
        {printingCount > 0 && (
          <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[11px] border-2 border-dark-black-900 bg-lime-300 font-figtree text-[12.5px] font-medium text-dark-black-900">
            <IconWifi size={14} className="text-dark-black-900/60" />
            {printingCount} printing
          </span>
        )}
      </div>

      {/* User menu */}
      <div className="relative">
        <button
          onClick={() => setUserOpen(!userOpen)}
          className="flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 transition-colors cursor-pointer"
        >
          <div className="w-9 h-9 rounded-[10px] bg-lime-300 border border-dark-black-900 flex items-center justify-center font-bold text-[12.5px] text-dark-black-900">
            AA
          </div>
          <span className="hidden sm:block text-left leading-tight">
            <span className="block font-figtree font-semibold text-[13px] text-dark-black-900">Andi Ahmad</span>
            <span className="block font-geist text-[10px] text-dark-black-900/50 uppercase tracking-wide">Owner</span>
          </span>
          <IconChevronDown size={15} className="text-dark-black-900/60" />
        </button>

        {userOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setUserOpen(false)} />
            <div className="absolute right-0 top-full mt-2 w-[230px] bg-vanilla-100 border-2 border-dark-black-900 rounded-[14px] shadow-xl overflow-hidden z-50 modal-in">
              <div className="px-4 py-3.5 border-b border-dark-black-900/10">
                <div className="font-figtree font-semibold text-[14px] text-dark-black-900">Andi Ahmad</div>
                <div className="font-figtree font-light text-dark-black-900/50 text-[12px]">andi@kroomprint.app</div>
              </div>
              <div className="p-2 flex flex-col">
                <button
                  onClick={() => { setUserOpen(false); onNavigate('settings') }}
                  className="w-full text-left px-3 py-2.5 rounded-[10px] hover:bg-vanilla-300/70 font-figtree text-[13.5px] font-medium text-dark-black-900 cursor-pointer"
                >
                  Settings
                </button>
                <button
                  onClick={() => { setUserOpen(false); toast('Signed out (demo)', 'info'); onLogout() }}
                  className="w-full text-left px-3 py-2.5 rounded-[10px] hover:bg-err-100 font-figtree text-[13.5px] font-medium text-err-500 cursor-pointer"
                >
                  Sign out
                </button>
              </div>
              <div className="px-4 py-2.5 border-t border-dark-black-900/10 font-geist text-[10.5px] text-dark-black-900/40 uppercase tracking-widest flex items-center gap-1.5">
                <IconLogout size={12} /> KroomPrint Pro
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
