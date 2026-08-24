import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import {
  IconGear,
  IconRefresh,
  IconAlert,
  IconCheck,
  IconWifi,
  IconTrash,
  IconPrinter,
  IconCheckCircle,
} from '../ui/icons'

function Toggle({ label, desc, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 w-full text-left py-3 cursor-pointer group"
    >
      <span>
        <span className="block font-figtree text-[14.5px] font-medium text-dark-black-900">{label}</span>
        {desc && <span className="block font-figtree font-light text-dark-black-900/50 text-[12.5px] mt-0.5">{desc}</span>}
      </span>
      <span
        className={`relative w-[48px] h-[27px] rounded-full border-2 border-dark-black-900 transition-colors duration-200 shrink-0 ${
          checked ? 'bg-lime-400' : 'bg-vanilla-300'
        }`}
      >
        <span
          className={`absolute top-[2px] w-[19px] h-[19px] rounded-full bg-vanilla-100 border border-dark-black-900 transition-all duration-200 ${
            checked ? 'left-[23px]' : 'left-[2px]'
          }`}
        />
      </span>
    </button>
  )
}

function Section({ title, desc, children }) {
  return (
    <div className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[20px] p-6">
      <div className="absolute -top-[9px] -right-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />
      <h2 className="font-figtree font-semibold text-[17px] text-dark-black-900">{title}</h2>
      {desc && <p className="font-figtree font-light text-dark-black-900/50 text-[13px] mt-0.5 mb-4">{desc}</p>}
      {!desc && <div className="mb-4" />}
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const {
    settings,
    setSettings,
    printers,
    defaultPrinter,
    toast,
    refreshAll,
    runDiagnostics,
    resetAllData,
  } = useApp()

  // Profile Form State
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({
    userName: settings.userName || 'Andi Ahmad',
    userEmail: settings.userEmail || 'andi@kroomprint.app',
    workspaceName: settings.workspaceName || 'KroomPrint Main',
    cupsURL: settings.cupsURL || 'http://localhost:631',
  })

  // Diagnostics Modal State
  const [diagOpen, setDiagOpen] = useState(false)
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagData, setDiagData] = useState(null)

  // Reset Modal State
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetConfirmed, setResetConfirmed] = useState(false)

  // Handle Save Profile
  const handleSaveProfile = async (e) => {
    e?.preventDefault()
    try {
      await setSettings({
        ...settings,
        userName: profileForm.userName,
        userEmail: profileForm.userEmail,
        workspaceName: profileForm.workspaceName,
        cupsURL: profileForm.cupsURL,
      })
      setEditingProfile(false)
      toast('Profil dan preferensi server berhasil disimpan', 'success')
    } catch (err) {
      toast(`Gagal menyimpan: ${err.message}`, 'error')
    }
  }

  // Handle Run Diagnostics
  const handleStartDiagnostics = async () => {
    setDiagOpen(true)
    setDiagLoading(true)
    setDiagData(null)
    try {
      const data = await runDiagnostics()
      setDiagData(data)
    } catch (err) {
      toast(`Gagal menjalankan diagnostik: ${err.message}`, 'error')
    } finally {
      setDiagLoading(false)
    }
  }

  // Handle Execute Reset
  const handleExecuteReset = async () => {
    if (!resetConfirmed) return
    setResetting(true)
    try {
      await resetAllData()
      setResetOpen(false)
      setResetConfirmed(false)
    } catch (err) {
      toast(`Gagal reset data: ${err.message}`, 'error')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="w-[14px] h-[14px] bg-lime-300 border border-dark-black-900 rounded-[2px] inline-block" />
          <span className="font-geist text-[11px] uppercase tracking-widest text-dark-black-900/60 font-medium">Configuration</span>
        </div>
        <h1 className="font-figtree font-semibold text-[36px] leading-tight text-dark-black-900">Settings</h1>
        <p className="font-figtree font-light text-dark-black-900/60 text-[15px] mt-0.5">
          Application preferences for your workspace.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* ── Preferences ── */}
        <Section title="Preferences" desc="Tune how KroomPrint behaves for your workflow.">
          <div className="flex flex-col divide-y divide-dark-black-900/10">
            <Toggle
              label="Auto-refresh printer status"
              desc="Poll printer status & queue in real-time"
              checked={settings.autoRefresh}
              onChange={(v) => {
                setSettings({ ...settings, autoRefresh: v })
                toast(`Auto-refresh ${v ? 'diaktifkan' : 'dinonaktifkan'}`, 'info')
              }}
            />
            <Toggle
              label="Job notifications"
              desc="Show alerts when a job completes or fails"
              checked={settings.notifications}
              onChange={(v) => {
                setSettings({ ...settings, notifications: v })
                toast(`Notifikasi job ${v ? 'diaktifkan' : 'dinonaktifkan'}`, 'info')
              }}
            />
            <Toggle
              label="Dark mode (Glassmorphism Dark)"
              desc="Switch interface color theme palette"
              checked={settings.darkMode}
              onChange={(v) => {
                setSettings({ ...settings, darkMode: v })
                toast(`Tema ${v ? 'Dark Mode' : 'Light Mode'} diaktifkan`, 'info')
              }}
            />
            <Toggle
              label="Compact queue view"
              desc="Show condensed job cards per row in the queue"
              checked={settings.compactQueue}
              onChange={(v) => {
                setSettings({ ...settings, compactQueue: v })
                toast(`Tampilan antrean ${v ? 'Compact' : 'Standard'}`, 'info')
              }}
            />
          </div>
        </Section>

        {/* ── Account & Workspace ── */}
        <Section title="Account & Workspace" desc="Your profile, workspace, and registered device quota.">
          <div className="flex items-center gap-4 p-4 rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 mb-5">
            <div className="w-14 h-14 rounded-[14px] bg-lime-300 border-2 border-dark-black-900 flex items-center justify-center font-bold text-[18px] text-dark-black-900 shrink-0">
              {profileForm.userName?.slice(0, 2).toUpperCase() || 'AA'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-figtree font-bold text-[16px] text-dark-black-900 truncate">
                {settings.userName || 'Andi Ahmad'}
              </div>
              <div className="font-figtree font-light text-dark-black-900/55 text-[13px] truncate">
                {settings.userEmail || 'andi@kroomprint.app'}
              </div>
              <div className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full border border-dark-black-900 bg-lime-300 text-[11px] font-semibold font-figtree text-dark-black-900">
                <IconGear size={11} /> {settings.workspaceName || 'KroomPrint Main'} · Owner
              </div>
            </div>
            <Button
              variant={editingProfile ? 'dark' : 'vanilla'}
              size="sm"
              onClick={() => setEditingProfile(!editingProfile)}
            >
              {editingProfile ? 'Cancel' : 'Edit Profile'}
            </Button>
          </div>

          {editingProfile ? (
            <form onSubmit={handleSaveProfile} className="flex flex-col gap-3 p-4 rounded-[14px] border-2 border-dark-black-900/30 bg-vanilla-100 mb-4">
              <div>
                <label className="block font-figtree font-medium text-[12.5px] text-dark-black-900/70 mb-1">Display Name</label>
                <input
                  type="text"
                  value={profileForm.userName}
                  onChange={(e) => setProfileForm({ ...profileForm, userName: e.target.value })}
                  className="w-full border-2 border-dark-black-900 bg-vanilla-200 rounded-[10px] px-3 py-2 font-figtree text-[13.5px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30"
                  required
                />
              </div>
              <div>
                <label className="block font-figtree font-medium text-[12.5px] text-dark-black-900/70 mb-1">Email Address</label>
                <input
                  type="email"
                  value={profileForm.userEmail}
                  onChange={(e) => setProfileForm({ ...profileForm, userEmail: e.target.value })}
                  className="w-full border-2 border-dark-black-900 bg-vanilla-200 rounded-[10px] px-3 py-2 font-figtree text-[13.5px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30"
                  required
                />
              </div>
              <div>
                <label className="block font-figtree font-medium text-[12.5px] text-dark-black-900/70 mb-1">Workspace Name</label>
                <input
                  type="text"
                  value={profileForm.workspaceName}
                  onChange={(e) => setProfileForm({ ...profileForm, workspaceName: e.target.value })}
                  className="w-full border-2 border-dark-black-900 bg-vanilla-200 rounded-[10px] px-3 py-2 font-figtree text-[13.5px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30"
                />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <Button type="button" variant="vanilla" size="sm" onClick={() => setEditingProfile(false)}>Cancel</Button>
                <Button type="submit" variant="lime" size="sm" icon={<IconCheck size={14} />}>Save Changes</Button>
              </div>
            </form>
          ) : null}

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
              <span className="font-figtree text-[14px] text-dark-black-900">Plan</span>
              <span className="font-geist text-[12.5px] font-medium text-dark-black-900/70">{settings.plan || 'KroomPrint Pro'}</span>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
              <span className="font-figtree text-[14px] text-dark-black-900">Registered printers</span>
              <span className="font-geist text-[12.5px] font-medium text-dark-black-900/70">{printers.length} active</span>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
              <span className="font-figtree text-[14px] text-dark-black-900">Default printer</span>
              <span className="font-figtree text-[12.5px] font-medium text-dark-black-900/70">{defaultPrinter?.name || '—'}</span>
            </div>
          </div>
        </Section>

        {/* ── CUPS Server & Remote Connectivity ── */}
        <Section title="CUPS & Remote Connectivity" desc="Configure print spooler daemon and backend host.">
          <div className="flex flex-col gap-3">
            <div className="p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100 flex flex-col gap-1">
              <span className="font-figtree text-[11px] uppercase tracking-wider text-dark-black-900/50 font-semibold">Configured CUPS Server</span>
              <span className="font-geist text-[13px] text-dark-black-900 font-medium break-all">{settings.cupsURL || 'http://localhost:631'}</span>
            </div>

            <div className="flex items-center gap-2 p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100 text-[12.5px] font-figtree text-dark-black-900/70">
              <IconCheckCircle size={16} className="text-ok-500 shrink-0" />
              IPP Everywhere & Raw AppSocket 9100 auto-negotiation active.
            </div>
          </div>
        </Section>

        {/* ── Diagnostics ── */}
        <Section title="Diagnostics & Maintenance" desc="Check real connectivity, latency, and spooler health.">
          <div className="flex flex-col gap-3">
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-500 transition-all font-figtree font-semibold text-[14px] text-dark-black-900 cursor-pointer w-full justify-center shadow-[2px_2px_0_0_rgba(56,56,56,1)] hover:-translate-y-0.5"
            >
              <IconRefresh size={16} /> Refresh All Printer Statuses
            </button>
            <button
              onClick={handleStartDiagnostics}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 transition-all font-figtree font-semibold text-[14px] text-dark-black-900 cursor-pointer w-full justify-center shadow-[2px_2px_0_0_rgba(56,56,56,1)] hover:-translate-y-0.5"
            >
              <IconWifi size={16} /> Run Network & CUPS Diagnostics
            </button>
            <div className="flex items-center gap-2 p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100 text-[12.5px] font-figtree text-dark-black-900/70">
              <IconAlert size={15} className="text-warn-500 shrink-0" />
              Firmware & driver versions are verified automatically on connect.
            </div>
          </div>
        </Section>

        {/* ── Danger zone ── */}
        <div className="xl:col-span-2">
          <Section title="Danger Zone" desc="Destructive workspace operations — proceed with caution.">
            <div className="flex items-center justify-between gap-4 p-4 rounded-[14px] border-2 border-err-500 bg-err-100 flex-wrap sm:flex-nowrap">
              <div>
                <div className="font-figtree font-bold text-[15px] text-err-500">Reset All Workspace Data</div>
                <div className="font-figtree font-light text-err-500/80 text-[13px] mt-0.5">
                  Purges all active queue jobs, clears print history logs, and resets settings to clean defaults.
                </div>
              </div>
              <Button
                variant="danger"
                size="md"
                onClick={() => {
                  setResetConfirmed(false)
                  setResetOpen(true)
                }}
                icon={<IconTrash size={16} />}
              >
                Reset Data
              </Button>
            </div>
          </Section>
        </div>
      </div>

      {/* ── Diagnostics Modal ── */}
      <Modal
        open={diagOpen}
        onClose={() => setDiagOpen(false)}
        title="Network & CUPS Diagnostics"
        subtitle="Real-time connectivity and latency measurements"
        footer={
          <div className="flex justify-between w-full">
            <Button variant="vanilla" size="sm" onClick={handleStartDiagnostics} icon={<IconRefresh size={14} />}>
              Re-run Test
            </Button>
            <Button variant="dark" size="sm" onClick={() => setDiagOpen(false)}>
              Done
            </Button>
          </div>
        }
      >
        {diagLoading ? (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="w-14 h-14 rounded-[16px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center text-dark-black-900 mb-4 relative overflow-hidden">
              <IconWifi size={26} />
              <span className="absolute inset-0 bg-lime-300/50 animate-pulse" />
            </div>
            <div className="font-figtree font-semibold text-dark-black-900 text-[15px]">Running live diagnostics…</div>
            <div className="font-figtree font-light text-dark-black-900/50 text-[13px] mt-1">Measuring CUPS socket, gateway, and printer response latencies</div>
            <div className="w-full max-w-[260px] h-2 rounded-full bg-dark-black-900/10 border border-dark-black-900/20 mt-5 overflow-hidden">
              <div className="h-full bg-lime-400 rounded-full progress-stripes" style={{ width: '80%' }} />
            </div>
          </div>
        ) : diagData ? (
          <div className="flex flex-col gap-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* CUPS Daemon */}
              <div className="p-3.5 rounded-[12px] border-2 border-dark-black-900/20 bg-vanilla-100 flex flex-col gap-1">
                <span className="font-figtree text-[11px] uppercase tracking-wider text-dark-black-900/50 font-semibold">CUPS Daemon</span>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${diagData.cups?.online ? 'bg-ok-500' : 'bg-err-500'}`} />
                  <span className="font-figtree font-bold text-[13.5px] text-dark-black-900">
                    {diagData.cups?.online ? 'Connected' : 'Unreachable'}
                  </span>
                </div>
                <span className="font-geist text-[11px] text-dark-black-900/60">{diagData.cups?.latencyMs?.toFixed(2)} ms latency</span>
              </div>

              {/* Network Gateway */}
              <div className="p-3.5 rounded-[12px] border-2 border-dark-black-900/20 bg-vanilla-100 flex flex-col gap-1">
                <span className="font-figtree text-[11px] uppercase tracking-wider text-dark-black-900/50 font-semibold">Network Gateway</span>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${diagData.gateway?.online ? 'bg-ok-500' : 'bg-err-500'}`} />
                  <span className="font-figtree font-bold text-[13.5px] text-dark-black-900">
                    {diagData.gateway?.online ? 'Online' : 'Unreachable'}
                  </span>
                </div>
                <span className="font-geist text-[11px] text-dark-black-900/60">{diagData.gateway?.latencyMs?.toFixed(2)} ms latency</span>
              </div>

              {/* Spool Storage */}
              <div className="p-3.5 rounded-[12px] border-2 border-dark-black-900/20 bg-vanilla-100 flex flex-col gap-1">
                <span className="font-figtree text-[11px] uppercase tracking-wider text-dark-black-900/50 font-semibold">Spool Storage</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-ok-500" />
                  <span className="font-figtree font-bold text-[13.5px] text-dark-black-900">Ready</span>
                </div>
                <span className="font-geist text-[11px] text-dark-black-900/60">{diagData.storage?.status || 'Spool OK'}</span>
              </div>
            </div>

            {/* Printers Latency Checklist */}
            <div className="border-2 border-dark-black-900/20 bg-vanilla-100 rounded-[14px] p-4">
              <div className="font-figtree font-bold text-[13.5px] text-dark-black-900 mb-3 flex items-center gap-2">
                <IconPrinter size={16} /> Device Response Times
              </div>
              <div className="flex flex-col divide-y divide-dark-black-900/10">
                {diagData.printers?.map((p) => (
                  <div key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-figtree font-semibold text-[13.5px] text-dark-black-900 truncate">{p.name}</div>
                      <div className="font-geist text-[11px] text-dark-black-900/50 truncate">{p.address}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-geist text-[12px] font-medium text-dark-black-900/70">{p.latencyMs?.toFixed(1)} ms</span>
                      <span className="px-2 py-0.5 rounded-full border border-dark-black-900 bg-lime-300 text-[11px] font-bold text-dark-black-900">
                        Online
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Reset Data Confirmation Modal ── */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset All Workspace Data?"
        subtitle="This action cannot be undone."
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="vanilla" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={handleExecuteReset}
              disabled={!resetConfirmed || resetting}
              icon={<IconTrash size={16} />}
            >
              {resetting ? 'Resetting…' : 'Yes, Purge All Data'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="p-4 rounded-[12px] border-2 border-err-500/40 bg-err-100 text-err-500 font-figtree text-[13.5px] leading-relaxed">
            <strong>Warning:</strong> You are about to clear all active printing queues, delete all job history logs, and reset user preferences back to default.
          </div>

          <label className="flex items-start gap-3 p-3 rounded-[12px] border-2 border-dark-black-900/20 bg-vanilla-100 cursor-pointer">
            <input
              type="checkbox"
              checked={resetConfirmed}
              onChange={(e) => setResetConfirmed(e.target.checked)}
              className="mt-1 w-4 h-4 rounded accent-lime-400 cursor-pointer"
            />
            <span className="font-figtree text-[13px] text-dark-black-900 leading-snug">
              I understand that all active print queues and historical logs will be permanently deleted.
            </span>
          </label>
        </div>
      </Modal>
    </div>
  )
}
