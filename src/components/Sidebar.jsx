import { useApp } from '../context/AppContext'

/**
 * Sidebar navigation with the Bugster design language.
 */
const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'print', label: 'Print', icon: 'upload' },
  { id: 'printers', label: 'Printers', icon: 'printer' },
  { id: 'queue', label: 'Queue', icon: 'queue' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
]

import {
  IconGear, IconHistory, IconHome, IconPrinter, IconQueue, IconUpload,
} from './ui/icons'

export default function Sidebar({ current, onNavigate, collapsed = false }) {
  const { queueCount, printers, activeCount } = useApp()

  const icons = { home: IconHome, upload: IconUpload, printer: IconPrinter, queue: IconQueue, history: IconHistory, gear: IconGear }

  return (
    <aside
      className={`hidden md:flex flex-col shrink-0 h-full border-r-2 border-dark-black-900 bg-vanilla-200 transition-all duration-300 ${
        collapsed ? 'w-[76px]' : 'w-[248px]'
      }`}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 h-[76px] border-b-2 border-dark-black-900 shrink-0">
        <div className="w-10 h-10 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center relative shrink-0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#383838" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9V3h12v6" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          <span className="absolute -top-[5px] -right-[5px] w-[10px] h-[10px] bg-sky-blue-500 border border-dark-black-900 rounded-[2px]" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-figtree font-bold text-[19px] text-dark-black-900 tracking-tight">KroomPrint</div>
            <div className="font-geist text-[10.5px] text-dark-black-900/50 uppercase tracking-widest">Wireless Print</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-5 px-3 flex flex-col gap-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = icons[item.icon]
          const active = current === item.id
          const badge = item.id === 'queue' ? queueCount : item.id === 'printers' ? activeCount : null
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`relative flex items-center gap-3 px-3.5 py-2.5 rounded-[12px] border transition-all duration-200 font-figtree text-[14.5px] font-medium cursor-pointer ${
                active
                  ? 'bg-dark-black-900 text-vanilla-100 border-dark-black-900'
                  : 'border-transparent text-dark-black-900/70 hover:bg-vanilla-300/60 hover:border-dark-black-900/20'
              }`}
              title={collapsed ? item.label : undefined}
            >
              {active && (
                <span className="absolute -left-[4px] top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-[2px] bg-lime-300 border border-dark-black-900" />
              )}
              <Icon size={20} className="shrink-0" />
              {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
              {!collapsed && badge > 0 && (
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

      {/* User */}
      <div className="border-t-2 border-dark-black-900 p-3">
        <div
          className={`flex items-center gap-3 rounded-[12px] border border-dark-black-900 bg-vanilla-100 p-3 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <div className="w-9 h-9 rounded-[10px] bg-lime-300 border border-dark-black-900 flex items-center justify-center font-bold text-[13px] text-dark-black-900 shrink-0">
            AA
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="font-figtree font-semibold text-[13.5px] text-dark-black-900 truncate">Andi Ahmad</div>
              <div className="font-geist text-[10.5px] text-dark-black-900/50">Owner · Pro</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
