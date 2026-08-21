import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import StatusBadge from '../ui/Badges'
import {
  IconPrinter, IconPlus, IconTrash, IconPencil, IconStar, IconPower,
  IconPause, IconPlay, IconRefresh, IconWifi, IconUsb, IconSearch,
  IconCheck, IconEye, IconAlert, IconQueue,
} from '../ui/icons'

const printerIcons = [
  { id: 'hp', label: 'HP', bg: 'bg-sky-blue-100' },
  { id: 'epson', label: 'Epson', bg: 'bg-lime-300' },
  { id: 'canon', label: 'Canon', bg: 'bg-err-100' },
  { id: 'brother', label: 'Brother', bg: 'bg-warn-100' },
  { id: 'generic', label: 'Generic', bg: 'bg-vanilla-300' },
]

const CONN_META = {
  Network: { icon: <IconWifi size={14} />, label: 'Network' },
  WiFi: { icon: <IconWifi size={14} />, label: 'WiFi' },
  USB: { icon: <IconUsb size={14} />, label: 'USB' },
}

export default function PrintersPage() {
  const app = useApp()
  const {
    printers, refreshPrinter, addPrinter, removePrinter, renamePrinter, setDefaultPrinter,
    togglePrinterEnable, togglePrinterPause, testPrint, scanForPrinters, addDiscovered, toast,
  } = app

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [renameId, setRenameId] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discovered, setDiscovered] = useState([])

  const [form, setForm] = useState({ name: '', brand: 'HP', model: '', connection: 'Network', address: '', isDefault: false })

  const filtered = useMemo(() => {
    return printers.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false
      if (search && !`${p.name} ${p.brand} ${p.model} ${p.address}`.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [printers, search, filter])

  const detail = printers.find((p) => p.id === detailId)

  const submitAdd = async () => {
    if (!form.name.trim() || !form.address.trim()) {
      toast('Printer name and address are required', 'error')
      return
    }
    try {
      await addPrinter({
        name: form.name.trim(),
        brand: form.brand,
        model: form.model.trim() || 'Unknown model',
        connection: form.connection,
        address: form.address.trim(),
        isDefault: form.isDefault,
      })
      setAddOpen(false)
      setForm({ name: '', brand: 'HP', model: '', connection: 'Network', address: '', isDefault: false })
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const submitRename = async () => {
    if (!renameVal.trim()) return
    try {
      await renamePrinter(renameId, renameVal.trim())
      setRenameId(null)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const startDiscovery = async () => {
    setDiscoverOpen(true)
    setDiscovering(true)
    setDiscovered([])
    try {
      const devices = await scanForPrinters()
      setDiscovered(devices)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setDiscovering(false)
    }
  }

  const handleAddDiscovered = async (d) => {
    try {
      await addDiscovered(d.id)
      setDiscovered((list) => list.filter((x) => x.id !== d.id))
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const capsBadges = (p) => {
    const items = []
    if (p.caps?.color) items.push({ label: 'Color', bg: 'bg-err-100' })
    if (p.caps?.duplex) items.push({ label: 'Duplex', bg: 'bg-sky-blue-100' })
    return items
  }

  return (
    <div className="flex flex-col gap-7">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-[14px] h-[14px] bg-lime-300 border border-dark-black-900 rounded-[2px] inline-block" />
            <span className="font-geist text-[11px] uppercase tracking-widest text-dark-black-900/60 font-medium">Devices</span>
          </div>
          <h1 className="font-figtree font-semibold text-[36px] leading-tight text-dark-black-900">Printers</h1>
          <p className="font-figtree font-light text-dark-black-900/60 text-[15px] mt-0.5">
            Scan your network, then add the printers you want to use.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="vanilla" onClick={startDiscovery} icon={<IconWifi size={17} />}>
            Scan network
          </Button>
          <Button variant="lime" onClick={() => setAddOpen(true)} icon={<IconPlus size={17} />}>
            Add manually
          </Button>
        </div>
      </div>

      {/* Filter + search */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <IconSearch size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-black-900/50 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search printers, models, IP…"
            className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] pl-10 pr-4 py-2.5 font-figtree text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
          />
        </div>
        <div className="flex gap-1.5 p-1 border-2 border-dark-black-900 rounded-[12px] bg-vanilla-100">
          {[
            { id: 'all', label: `All (${printers.length})` },
            { id: 'online', label: `Online (${printers.filter((p) => p.status === 'online' && p.enabled).length})` },
            { id: 'paused', label: 'Paused' },
            { id: 'offline', label: 'Offline' },
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

      {/* Printer cards */}
      {filtered.length === 0 ? (
        <div className="border-2 border-dashed border-dark-black-900/40 rounded-[20px] py-16 flex flex-col items-center text-center bg-vanilla-100/50">
          <div className="w-16 h-16 rounded-[18px] border-2 border-dark-black-900 bg-vanilla-200 flex items-center justify-center text-dark-black-900/40 mb-4">
            <IconPrinter size={30} />
          </div>
          <div className="font-figtree font-medium text-dark-black-900 text-[15px]">No printers found</div>
          <div className="font-figtree font-light text-dark-black-900/50 text-[13px]">Try scanning your network or add one manually</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((p) => {
            const icon = printerIcons.find((i) => i.label === p.brand) || printerIcons[printerIcons.length - 1]
            const conn = CONN_META[p.connection] || CONN_META.Network
            return (
              <div key={p.id} className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[20px] p-5 flex flex-col gap-4 hover:shadow-lg transition-shadow">
                <div className="absolute -top-[9px] -left-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-12 h-12 rounded-[14px] border-2 border-dark-black-900 ${icon.bg} flex items-center justify-center text-dark-black-900 shrink-0 relative`}>
                      <IconPrinter size={24} />
                      {p.isDefault && (
                        <span className="absolute -top-[7px] -right-[7px] w-[16px] h-[16px] bg-lime-300 border border-dark-black-900 rounded-[3px] flex items-center justify-center">
                          <IconStar size={9} />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-figtree font-bold text-[15.5px] text-dark-black-900 truncate">{p.name}</div>
                      <div className="font-figtree font-light text-dark-black-900/55 text-[12.5px]">
                        {p.brand} {p.model}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>

                {/* Connection line */}
                <div className="flex items-center gap-2 text-dark-black-900/55 font-figtree text-[12.5px]">
                  {conn.icon}
                  <span className="font-geist text-[11.5px]">{conn.label} · {p.address}</span>
                </div>

                {/* Capability badges */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {capsBadges(p).map((b) => (
                    <span key={b.label} className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold font-geist border border-dark-black-900/50 ${b.bg} text-dark-black-900`}>
                      {b.label.toUpperCase()}
                    </span>
                  ))}
                  <span className="px-2 py-0.5 rounded-md text-[10.5px] font-bold font-geist border border-dark-black-900/50 bg-vanilla-300 text-dark-black-900">
                    {p.caps?.paperSizes?.length || 0} SIZES
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap pt-1 mt-auto">
                  <button
                    onClick={() => setDetailId(p.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 transition-colors font-figtree text-[12.5px] font-semibold text-dark-black-900 cursor-pointer"
                  >
                    <IconEye size={14} /> Details
                  </button>
                  <button
                    onClick={() => { setRenameId(p.id); setRenameVal(p.name) }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 transition-colors font-figtree text-[12.5px] font-semibold text-dark-black-900 cursor-pointer"
                  >
                    <IconPencil size={14} /> Rename
                  </button>
                  {!p.isDefault && (
                    <button
                      onClick={() => setDefaultPrinter(p.id)}
                      title="Set as default"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-500 transition-colors font-figtree text-[12.5px] font-semibold text-dark-black-900 cursor-pointer"
                    >
                      <IconStar size={14} /> Default
                    </button>
                  )}
                  <button
                    onClick={() => togglePrinterEnable(p.id)}
                    title={p.enabled ? 'Disable printer' : 'Enable printer'}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border-2 transition-colors font-figtree text-[12.5px] font-semibold cursor-pointer ${
                      p.enabled ? 'border-dark-black-900 bg-vanilla-100 hover:bg-err-100 hover:text-err-500' : 'border-dark-black-900 bg-ok-100 hover:bg-ok-500 hover:text-white'
                    }`}
                  >
                    <IconPower size={14} /> {p.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => togglePrinterPause(p.id)}
                    title={p.paused ? 'Resume printer' : 'Pause printer'}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border-2 transition-colors font-figtree text-[12.5px] font-semibold cursor-pointer ${
                      p.paused ? 'border-dark-black-900 bg-lime-300 hover:bg-lime-500' : 'border-dark-black-900 bg-vanilla-100 hover:bg-warn-100'
                    }`}
                  >
                    {p.paused ? <IconPlay size={14} /> : <IconPause size={14} />} {p.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    onClick={() => testPrint(p.id)}
                    title="Ping device & check connection"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 transition-colors font-figtree text-[12.5px] font-semibold text-dark-black-900 cursor-pointer"
                  >
                    <IconWifi size={14} /> Ping Test
                  </button>
                  <button
                    onClick={() => refreshPrinter(p.id)}
                    title="Refresh status"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 transition-colors font-figtree text-[12.5px] font-semibold text-dark-black-900 cursor-pointer"
                  >
                    <IconRefresh size={14} /> Refresh
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove "${p.name}" from KroomPrint?`)) removePrinter(p.id)
                    }}
                    title="Remove printer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border-2 border-err-500 bg-err-100 hover:bg-err-500 hover:text-white transition-colors font-figtree text-[12.5px] font-semibold text-err-500 cursor-pointer ml-auto"
                  >
                    <IconTrash size={14} /> Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add manually modal ── */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add printer"
        subtitle="Register a printer manually — capabilities will be probed"
        footer={
          <>
            <Button variant="vanilla" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="lime" onClick={submitAdd} icon={<IconPlus size={16} />}>Add printer</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 col-span-2">
            <span className="font-figtree text-[13px] font-medium text-dark-black-900">Printer name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Office Printer"
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-figtree text-[14px] focus:outline-none focus:bg-lime-300/30 placeholder:text-dark-black-900/30"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-figtree text-[13px] font-medium text-dark-black-900">Brand</span>
            <select
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-figtree text-[14px] focus:outline-none focus:bg-lime-300/30 cursor-pointer"
            >
              {['HP', 'Epson', 'Canon', 'Brother', 'Samsung', 'Xerox', 'Generic'].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-figtree text-[13px] font-medium text-dark-black-900">Model</span>
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="e.g. LaserJet Pro"
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-figtree text-[14px] focus:outline-none focus:bg-lime-300/30 placeholder:text-dark-black-900/30"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-figtree text-[13px] font-medium text-dark-black-900">Connection</span>
            <select
              value={form.connection}
              onChange={(e) => setForm({ ...form, connection: e.target.value })}
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-figtree text-[14px] focus:outline-none focus:bg-lime-300/30 cursor-pointer"
            >
              {['Network', 'WiFi', 'USB'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-figtree text-[13px] font-medium text-dark-black-900">
              {form.connection === 'USB' ? 'USB port' : 'IP address'}
            </span>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder={form.connection === 'USB' ? 'e.g. USB-003' : 'e.g. 192.168.1.50'}
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-geist text-[13px] focus:outline-none focus:bg-lime-300/30 placeholder:text-dark-black-900/30"
            />
          </label>
        </div>
        <label className="flex items-center gap-3 mt-5 p-3.5 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 cursor-pointer">
          <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="w-4 h-4 accent-dark-black-900" />
          <span className="font-figtree text-[14px] font-medium text-dark-black-900">Set as default printer</span>
        </label>
      </Modal>

      {/* ── Rename modal ── */}
      <Modal
        open={!!renameId}
        onClose={() => setRenameId(null)}
        title="Rename printer"
        subtitle="Give this printer a friendly name"
        size="sm"
        footer={
          <>
            <Button variant="vanilla" onClick={() => setRenameId(null)}>Cancel</Button>
            <Button variant="lime" onClick={submitRename} icon={<IconCheck size={16} />}>Save name</Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className="font-figtree text-[13px] font-medium text-dark-black-900">Printer name</span>
          <input
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitRename()}
            autoFocus
            className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[11px] px-3.5 py-2.5 font-figtree text-[14px] focus:outline-none focus:bg-lime-300/30"
          />
        </label>
      </Modal>

      {/* ── Details modal ── */}
      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        title={detail?.name || 'Printer'}
        subtitle={detail ? `${detail.brand} ${detail.model}` : ''}
        size="md"
        footer={<Button variant="dark" onClick={() => setDetailId(null)}>Close</Button>}
      >
        {detail && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <StatusBadge status={detail.status} />
              {detail.isDefault && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-dark-black-900 bg-lime-300 text-[12px] font-semibold font-figtree text-dark-black-900">
                  <IconStar size={12} /> Default
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Connection', value: detail.connection },
                { label: 'Address', value: detail.address },
                { label: 'MAC address', value: detail.mac || '—' },
                { label: 'Speed', value: detail.speed || '—' },
                { label: 'Duplex', value: detail.caps?.duplex ? 'Supported' : 'Not supported' },
                { label: 'Color', value: detail.caps?.color ? 'Color printer' : 'Monochrome' },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3 p-3 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
                  <div className="min-w-0">
                    <div className="font-figtree text-[11px] font-medium text-dark-black-900/50 uppercase tracking-wide">{row.label}</div>
                    <div className="font-geist text-[12.5px] text-dark-black-900 truncate">{row.value}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Capabilities */}
            <div>
              <div className="font-figtree text-[12px] font-semibold text-dark-black-900/60 uppercase tracking-wide mb-2">Capabilities</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
                  <div className="font-figtree text-[11px] font-medium text-dark-black-900/50 uppercase tracking-wide mb-1">Paper sizes</div>
                  <div className="flex flex-wrap gap-1">
                    {detail.caps?.paperSizes?.map((s) => (
                      <span key={s} className="px-2 py-0.5 rounded-md bg-vanilla-300 border border-dark-black-900/40 font-geist text-[10.5px] font-bold text-dark-black-900">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="p-3 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
                  <div className="font-figtree text-[11px] font-medium text-dark-black-900/50 uppercase tracking-wide mb-1">Quality</div>
                  <div className="flex flex-wrap gap-1">
                    {detail.caps?.qualities?.map((s) => (
                      <span key={s} className="px-2 py-0.5 rounded-md bg-lime-300 border border-dark-black-900/40 font-geist text-[10.5px] font-bold text-dark-black-900">{s}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-dark-black-900/10">
              <Button variant="vanilla" size="sm" onClick={() => refreshPrinter(detail.id)} icon={<IconRefresh size={14} />}>Refresh status</Button>
              <Button variant="vanilla" size="sm" onClick={() => testPrint(detail.id)} icon={<IconWifi size={14} />}>Ping device</Button>
              <Button variant="vanilla" size="sm" onClick={() => togglePrinterPause(detail.id)} icon={detail.paused ? <IconPlay size={14} /> : <IconPause size={14} />}>
                {detail.paused ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="vanilla" size="sm" onClick={() => togglePrinterEnable(detail.id)} icon={<IconPower size={14} />}>
                {detail.enabled ? 'Disable' : 'Enable'}
              </Button>
              {!detail.isDefault && (
                <Button variant="lime" size="sm" onClick={() => setDefaultPrinter(detail.id)} icon={<IconStar size={14} />}>Set default</Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Discovery modal ── */}
      <Modal
        open={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        title="Printer discovery"
        subtitle={discovering ? 'Scanning your local network for printers…' : `${discovered.length} printer${discovered.length !== 1 ? 's' : ''} found`}
        footer={
          <Button variant="dark" onClick={() => setDiscoverOpen(false)}>Done</Button>
        }
      >
        {discovering ? (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="w-14 h-14 rounded-[16px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center text-dark-black-900 mb-4 relative overflow-hidden">
              <IconWifi size={26} />
              <span className="absolute inset-0 bg-lime-300/50 animate-pulse" />
            </div>
            <div className="font-figtree font-semibold text-dark-black-900 text-[15px]">Scanning network…</div>
            <div className="font-figtree font-light text-dark-black-900/50 text-[13px] mt-1">Probing IPP/CUPS endpoints on your LAN</div>
            <div className="w-full max-w-[260px] h-2 rounded-full bg-dark-black-900/10 border border-dark-black-900/20 mt-5 overflow-hidden">
              <div className="h-full bg-lime-400 rounded-full progress-stripes" style={{ width: '65%' }} />
            </div>
          </div>
        ) : discovered.length === 0 ? (
          <div className="text-center py-8 font-figtree font-light text-dark-black-900/60 text-[14px]">No new printers discovered on the network.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {discovered.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3.5 rounded-[14px] border-2 border-dark-black-900/25 bg-vanilla-100">
                <div className="w-10 h-10 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-200 flex items-center justify-center text-dark-black-900 shrink-0">
                  <IconPrinter size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-figtree font-semibold text-[14px] text-dark-black-900 truncate">{d.name}</div>
                  <div className="font-geist text-[11.5px] text-dark-black-900/50">
                    {d.connection} · {d.address} · {d.caps?.color ? 'Color' : 'Mono'} {d.caps?.duplex ? '· Duplex' : ''}
                  </div>
                </div>
                <Button variant="lime" size="sm" onClick={() => handleAddDiscovered(d)} icon={<IconPlus size={14} />}>Add</Button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
