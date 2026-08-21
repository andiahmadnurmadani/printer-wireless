import { useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import StatusBadge from '../ui/Badges'
import { IconPrinter, IconQueue, IconClock, IconCheckCircle, IconWifi, IconUsb, IconStar, IconRefresh, IconPlay, IconPause } from '../ui/icons'

function StatCard({ icon, label, value, sub, accent = 'lime' }) {
  const accents = {
    lime: 'bg-lime-300',
    sky: 'bg-sky-blue-100',
    ok: 'bg-ok-100',
    warn: 'bg-warn-100',
    err: 'bg-err-100',
  }
  return (
    <div className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[20px] p-5 flex flex-col gap-3 hover:shadow-lg transition-shadow">
      <div className="absolute -top-[9px] -right-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />
      <div className={`w-11 h-11 rounded-[12px] border border-dark-black-900 ${accents[accent]} flex items-center justify-center text-dark-black-900`}>
        {icon}
      </div>
      <div>
        <div className="font-geist font-bold text-[32px] text-dark-black-900 leading-none">{value}</div>
        <div className="font-figtree font-medium text-dark-black-900 text-[14px] mt-1">{label}</div>
        {sub && <div className="font-figtree font-light text-dark-black-900/50 text-[12.5px]">{sub}</div>}
      </div>
    </div>
  )
}

export default function Dashboard({ onNavigate }) {
  const { printers, jobs, history, refreshAll, defaultPrinter, activeCount, queueCount } = useApp()

  const stats = useMemo(() => {
    const printing = jobs.filter((j) => j.status === 'printing')
    const completedToday = history.filter((h) => h.status === 'completed' && Date.now() - h.createdAt < 86400000).length
    return { printing, completedToday }
  }, [jobs, history])

  return (
    <div className="flex flex-col gap-7">
      {/* Header row */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-[14px] h-[14px] bg-lime-300 border border-dark-black-900 rounded-[2px] inline-block" />
            <span className="font-geist text-[11px] uppercase tracking-widest text-dark-black-900/60 font-medium">Overview</span>
          </div>
          <h1 className="font-figtree font-semibold text-[36px] leading-tight text-dark-black-900">Dashboard</h1>
          <p className="font-figtree font-light text-dark-black-900/60 text-[15px] mt-0.5">
            Welcome back, Andi. Here&apos;s what&apos;s happening with your printers.
          </p>
        </div>
        <button
          onClick={refreshAll}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 transition-all duration-200 font-figtree font-semibold text-[13.5px] text-dark-black-900 cursor-pointer"
        >
          <IconRefresh size={16} /> Refresh All
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <StatCard icon={<IconPrinter size={22} />} value={activeCount} label="Printers online" sub={`${printers.length} total registered`} accent="lime" />
        <StatCard icon={<IconQueue size={22} />} value={queueCount} label="Jobs in queue" sub={stats.printing.length ? `${stats.printing.length} printing now` : 'Queue is idle'} accent="sky" />
        <StatCard icon={<IconCheckCircle size={22} />} value={stats.completedToday} label="Completed today" sub="last 24 hours" accent="ok" />
        <StatCard icon={<IconClock size={22} />} value={history.length} label="Total history" sub="all-time print records" accent="warn" />
      </div>

      {/* Main grid: default printer + live jobs */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Default printer card */}
        <div className="xl:col-span-2">
          <div className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[22px] p-6 h-full flex flex-col">
            <div className="absolute -bottom-[9px] -left-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-figtree font-semibold text-[19px] text-dark-black-900">Default printer</h2>
              <StatusBadge status={defaultPrinter?.status || 'offline'} />
            </div>

            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-[16px] border-2 border-dark-black-900 bg-vanilla-100 flex items-center justify-center text-dark-black-900 relative shrink-0">
                <IconPrinter size={28} />
                <span className="absolute -top-[6px] -right-[6px] w-[14px] h-[14px] bg-lime-300 border border-dark-black-900 rounded-[3px] flex items-center justify-center">
                  <IconStar size={9} />
                </span>
              </div>
              <div className="min-w-0">
                <div className="font-figtree font-bold text-[18px] text-dark-black-900 truncate">{defaultPrinter?.name}</div>
                <div className="font-figtree font-light text-dark-black-900/60 text-[13.5px]">
                  {defaultPrinter?.brand} {defaultPrinter?.model}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-dark-black-900/50 text-[12px] font-figtree">
                  {defaultPrinter?.connection === 'USB' ? <IconUsb size={13} /> : <IconWifi size={13} />}
                  <span className="font-geist text-[11.5px]">{defaultPrinter?.address}</span>
                </div>
              </div>
            </div>

            {/* Printer info (real data only) */}
            <div className="flex flex-col gap-2 mb-6">
              <div className="flex items-center justify-between">
                <span className="font-figtree text-[13px] font-medium text-dark-black-900">Status</span>
                <span className="font-geist text-[12px] text-dark-black-900/60 capitalize">
                  {defaultPrinter?.status === 'online' ? 'Online' : defaultPrinter?.status === 'paused' ? 'Paused' : defaultPrinter?.status || 'Unknown'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-figtree text-[13px] font-medium text-dark-black-900">Capabilities</span>
                <span className="font-geist text-[12px] text-dark-black-900/60">
                  {[defaultPrinter?.caps?.color ? 'Color' : null, defaultPrinter?.caps?.duplex ? 'Duplex' : null, defaultPrinter?.caps?.paperSizes?.length ? `${defaultPrinter.caps.paperSizes.length} sizes` : null].filter(Boolean).join(' · ') || '—'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap mt-auto">
              <button
                onClick={() => onNavigate('printers')}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-500 transition-all font-figtree font-semibold text-[13.5px] text-dark-black-900 cursor-pointer"
              >
                Manage printers
              </button>
              <button
                onClick={() => onNavigate('print')}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 transition-all font-figtree font-semibold text-[13.5px] text-dark-black-900 cursor-pointer"
              >
                New print job
              </button>
            </div>
          </div>
        </div>

        {/* Live jobs */}
        <div className="xl:col-span-3">
          <div className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[22px] overflow-hidden h-full flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b-2 border-dark-black-900">
              <h2 className="font-figtree font-semibold text-[19px] text-dark-black-900">Live print jobs</h2>
              <button onClick={() => onNavigate('queue')} className="font-figtree text-[13px] font-semibold text-dark-black-900/70 hover:text-dark-black-900 underline underline-offset-4 cursor-pointer">
                View queue →
              </button>
            </div>

            <div className="flex-1 p-5 flex flex-col gap-4 overflow-y-auto max-h-[340px]">
              {jobs.filter((j) => ['printing', 'queued', 'paused'].includes(j.status)).length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10">
                  <div className="w-16 h-16 rounded-[18px] border-2 border-dark-black-900 bg-vanilla-100 flex items-center justify-center text-dark-black-900/40 mb-4">
                    <IconQueue size={30} />
                  </div>
                  <div className="font-figtree font-medium text-dark-black-900 text-[15px]">No active jobs</div>
                  <div className="font-figtree font-light text-dark-black-900/50 text-[13px]">Submit a new print job to get started</div>
                </div>
              ) : (
                jobs
                  .filter((j) => ['printing', 'queued', 'paused'].includes(j.status))
                  .slice(0, 5)
                  .map((job) => {
                    const printer = printers.find((p) => p.id === job.printerId)
                    return (
                      <div key={job.id} className="border border-dark-black-900/25 rounded-[14px] p-4 bg-vanilla-100">
                        <div className="flex items-center justify-between gap-3 mb-2.5">
                          <div className="min-w-0 flex items-center gap-3">
                            <div
                              className={`w-9 h-9 rounded-[10px] border border-dark-black-900 flex items-center justify-center shrink-0 ${
                                job.status === 'printing' ? 'bg-lime-300' : job.status === 'paused' ? 'bg-warn-100' : 'bg-vanilla-300'
                              }`}
                            >
                              {job.status === 'printing' ? <IconPlay size={16} /> : job.status === 'paused' ? <IconPause size={16} /> : <IconQueue size={16} />}
                            </div>
                            <div className="min-w-0">
                              <div className="font-figtree font-semibold text-[14px] text-dark-black-900 truncate">{job.name}</div>
                              <div className="font-figtree font-light text-dark-black-900/50 text-[12px]">
                                {printer?.name || 'Unknown'} · {job.pages} pages · {job.copies} copy{job.copies > 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                          {job.status === 'printing' ? (
                            <span className="font-geist text-[12px] font-medium text-dark-black-900/70 shrink-0">{Math.round(job.progress)}%</span>
                          ) : (
                            <span className="font-figtree text-[11.5px] font-semibold uppercase tracking-wide text-dark-black-900/50 shrink-0">{job.status}</span>
                          )}
                        </div>
                        {job.status === 'printing' && (
                          <div className="h-2 rounded-full bg-dark-black-900/10 border border-dark-black-900/20 overflow-hidden">
                            <div
                              className="h-full bg-lime-400 rounded-full transition-all duration-700 progress-stripes"
                              style={{ width: `${job.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* All printers quick strip */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-figtree font-semibold text-[19px] text-dark-black-900">Your printers</h2>
          <button onClick={() => onNavigate('printers')} className="font-figtree text-[13px] font-semibold text-dark-black-900/70 hover:text-dark-black-900 underline underline-offset-4 cursor-pointer">
            Manage all →
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {printers.map((p) => (
            <div
              key={p.id}
              className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[18px] p-4 flex flex-col gap-2.5 hover:shadow-md transition-shadow"
            >
              {p.isDefault && (
                <span className="absolute -top-[8px] -left-[8px] w-[16px] h-[16px] bg-lime-300 border border-dark-black-900 rounded-[3px] flex items-center justify-center">
                  <IconStar size={10} />
                </span>
              )}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-[10px] border border-dark-black-900 bg-vanilla-100 flex items-center justify-center text-dark-black-900 shrink-0">
                    <IconPrinter size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-figtree font-semibold text-[14px] text-dark-black-900 truncate">{p.name}</div>
                    <div className="font-geist text-[10.5px] text-dark-black-900/50">{p.brand} {p.model}</div>
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="flex items-center gap-1.5 text-dark-black-900/50 font-figtree text-[12px]">
                {p.connection === 'USB' ? <IconUsb size={13} /> : <IconWifi size={13} />}
                <span className="font-geist text-[11px]">{p.address}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
