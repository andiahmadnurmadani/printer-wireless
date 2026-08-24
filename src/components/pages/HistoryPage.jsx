import { useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { api } from '../../api/client'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { FileTypeBadge } from '../ui/Badges'
import { IconHistory, IconPrinter, IconRefresh, IconPlay, IconSearch, IconTrash, IconDownload } from '../ui/icons'

const statusMeta = {
  completed: { label: 'Completed', cls: 'bg-ok-100 text-ok-500 border-dark-black-900' },
  failed: { label: 'Failed', cls: 'bg-err-100 text-err-500 border-err-500' },
  cancelled: { label: 'Cancelled', cls: 'bg-surface-gray-300 text-dark-gray-600 border-dark-black-900' },
}

export default function HistoryPage() {
  const { history, printers, retryJob, toast } = useApp()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)

  const filtered = useMemo(() => {
    return history
      .filter((h) => {
        if (filter !== 'all' && h.status !== filter) return false
        if (search && !`${h.name} ${h.printerName}`.toLowerCase().includes(search.toLowerCase())) return false
        return true
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [history, filter, search])

  const stats = useMemo(() => ({
    completed: history.filter((h) => h.status === 'completed').length,
    failed: history.filter((h) => h.status === 'failed').length,
    cancelled: history.filter((h) => h.status === 'cancelled').length,
    totalPages: history.reduce((acc, h) => acc + (h.status === 'completed' ? h.pages * h.copies : 0), 0),
    totalSpend: history.reduce((acc, h) => acc + (h.status === 'completed' ? (h.cost || 0) : 0), 0),
  }), [history])

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-[14px] h-[14px] bg-lime-300 border border-dark-black-900 rounded-[2px] inline-block" />
            <span className="font-geist text-[11px] uppercase tracking-widest text-dark-black-900/60 font-medium">Records & Audit</span>
          </div>
          <h1 className="font-figtree font-semibold text-[36px] leading-tight text-dark-black-900">Print history</h1>
          <p className="font-figtree font-light text-dark-black-900/60 text-[15px] mt-0.5">
            Every print job you've sent — audit logs, cost accounting, department analytics, and CSV export.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <a
            href={api.getAnalyticsExportUrl('csv')}
            download="kroomprint-audit-log.csv"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-400 font-figtree font-bold text-[13.5px] text-dark-black-900 transition-all shadow-[3px_3px_0_0_rgba(56,56,56,1)]"
          >
            <IconDownload size={16} /> Export Audit Log (CSV)
          </a>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total jobs', value: history.length, icon: <IconHistory size={18} />, bg: 'bg-lime-300' },
          { label: 'Completed', value: stats.completed, icon: <IconPrinter size={18} />, bg: 'bg-ok-100' },
          { label: 'Pages printed', value: stats.totalPages, icon: <IconDownload size={18} />, bg: 'bg-sky-blue-100' },
          { label: 'Total Spend', value: `Rp ${stats.totalSpend.toLocaleString('id-ID')}`, icon: <IconRefresh size={18} />, bg: 'bg-amber-300' },
        ].map((s) => (
          <div key={s.label} className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[16px] p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-[11px] border border-dark-black-900 ${s.bg} flex items-center justify-center text-dark-black-900 shrink-0`}>
              {s.icon}
            </div>
            <div>
              <div className="font-geist font-bold text-[20px] text-dark-black-900 leading-none">{s.value}</div>
              <div className="font-figtree text-[12.5px] text-dark-black-900/60 font-medium mt-0.5">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <IconSearch size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-black-900/50 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents or printers…"
            className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] pl-10 pr-4 py-2.5 font-figtree text-[14px] focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
          />
        </div>
        <div className="flex gap-1.5 p-1 border-2 border-dark-black-900 rounded-[12px] bg-vanilla-100">
          {[
            { id: 'all', label: `All (${history.length})` },
            { id: 'completed', label: 'Completed' },
            { id: 'failed', label: 'Failed' },
            { id: 'cancelled', label: 'Cancelled' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3.5 py-1.5 rounded-[9px] font-figtree text-[13px] font-medium transition-all cursor-pointer ${
                filter === f.id ? 'bg-dark-black-900 text-vanilla-100' : 'text-dark-black-900/60 hover:bg-vanilla-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-dark-black-900/40 rounded-[20px] py-16 flex flex-col items-center text-center bg-vanilla-100/50">
          <div className="w-16 h-16 rounded-[18px] border-2 border-dark-black-900 bg-vanilla-200 flex items-center justify-center text-dark-black-900/40 mb-4">
            <IconHistory size={30} />
          </div>
          <div className="font-figtree font-medium text-dark-black-900 text-[15px]">No history records</div>
          <div className="font-figtree font-light text-dark-black-900/50 text-[13px] mt-1">Completed and failed jobs will appear here.</div>
        </div>
      ) : (
        <div className="bg-vanilla-200 border-2 border-dark-black-900 rounded-[18px] overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-dark-black-900 bg-vanilla-100">
                {['Document', 'Printer', 'Dept / User', 'Pages', 'Cost (Rp)', 'Status', 'When', 'Duration', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-figtree text-[11.5px] font-semibold text-dark-black-900/60 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-black-900/10">
              {filtered.map((h) => {
                const meta = statusMeta[h.status] || statusMeta.cancelled
                return (
                  <tr key={h.id} className="hover:bg-lime-300/20 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileTypeBadge type={h.fileType} />
                        <span className="font-figtree font-semibold text-[14px] text-dark-black-900 truncate max-w-[200px]">{h.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 font-figtree text-[13.5px] text-dark-black-900/80">
                        <IconPrinter size={14} className="text-dark-black-900/50" /> {h.printerName}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-figtree text-[13px] text-dark-black-900/80">
                      <span className="font-medium text-dark-black-900 block">{h.department || 'Engineering'}</span>
                      <span className="text-[11px] text-dark-black-900/50">{h.user || 'Andi Ahmad'}</span>
                    </td>
                    <td className="px-4 py-3.5 font-geist text-[13px] text-dark-black-900/70">{h.pages * h.copies}</td>
                    <td className="px-4 py-3.5 font-geist font-bold text-[13px] text-dark-black-900">
                      Rp {(h.cost || 0).toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-semibold font-figtree ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-geist text-[12px] text-dark-black-900/60 whitespace-nowrap">
                      {new Date(h.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3.5 font-geist text-[12px] text-dark-black-900/60">{h.duration || '—'}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => setDetail(h)}
                          className="w-8 h-8 rounded-[9px] border border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 flex items-center justify-center cursor-pointer"
                          title="Details"
                        >
                          <IconSearch size={13} />
                        </button>
                        {h.status === 'failed' && (
                          <button
                            onClick={() => retryJob(h.id)}
                            className="inline-flex items-center gap-1 px-2.5 h-8 rounded-[9px] border border-dark-black-900 bg-lime-300 hover:bg-lime-500 font-figtree text-[11.5px] font-semibold text-dark-black-900 cursor-pointer"
                            title="Retry job"
                          >
                            <IconPlay size={12} /> Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail modal ── */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.name || 'Record'}
        subtitle={detail ? `Print record · ${new Date(detail.createdAt).toLocaleString()}` : ''}
        size="sm"
        footer={
          <Button variant="dark" onClick={() => setDetail(null)}>Close</Button>
        }
      >
        {detail && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <FileTypeBadge type={detail.fileType} />
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-semibold font-figtree ${(statusMeta[detail.status] || statusMeta.cancelled).cls}`}>
                {(statusMeta[detail.status] || statusMeta.cancelled).label}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Printer', value: detail.printerName },
                { label: 'Department', value: detail.department || 'Engineering' },
                { label: 'User', value: detail.user || 'Andi Ahmad' },
                { label: 'Total Pages', value: String(detail.pages * detail.copies) },
                { label: 'Cost Charged', value: `Rp ${(detail.cost || 0).toLocaleString('id-ID')}` },
                { label: 'Duration', value: detail.duration || '—' },
              ].map((row) => (
                <div key={row.label} className="p-3 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
                  <div className="font-figtree text-[11px] font-medium text-dark-black-900/50 uppercase tracking-wide">{row.label}</div>
                  <div className="font-figtree text-[13.5px] font-medium text-dark-black-900 mt-0.5">{row.value}</div>
                </div>
              ))}
            </div>
            {detail.error && (
              <div className="p-3 bg-err-100 border border-err-500 rounded-[12px] text-[12.5px] font-figtree text-err-700">
                <b>Error:</b> {detail.error}
              </div>
            )}
            {detail.status === 'failed' && !detail.error && (
              <div className="flex items-center gap-2 p-3.5 rounded-[12px] border-2 border-err-500 bg-err-100 font-figtree text-[13px] text-err-500 font-medium">
                <IconRefresh size={15} className="shrink-0" />
                This job failed. Check the printer connection and try again.
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
