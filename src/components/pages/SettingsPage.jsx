import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { useAuth, Only } from '../../context/AuthContext'
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
  IconCrown,
  IconUser,
  IconEye,
  IconLock,
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
    <div className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[20px] p-6 shadow-xs">
      <div className="absolute -top-[9px] -right-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />
      <h2 className="font-figtree font-semibold text-[17px] text-dark-black-900">{title}</h2>
      {desc && <p className="font-figtree font-light text-dark-black-900/50 text-[13px] mt-0.5 mb-4">{desc}</p>}
      {!desc && <div className="mb-4" />}
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const { user, isGuest, openLoginModal } = useAuth()
  const {
    settings,
    setSettings,
    printers,
    defaultPrinter,
    toast,
    refreshAll,
    runDiagnostics,
    resetAllData,
    changePassword,
    testCUPS,
  } = useApp()

  // Profile Form State
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({
    userName: settings.userName || (user?.username === 'admin' ? 'Administrator' : user?.username || 'Andi Ahmad'),
    userEmail: settings.userEmail || (user?.username === 'admin' ? 'admin@kroomprint.app' : 'user@kroomprint.app'),
    workspaceName: settings.workspaceName || 'KroomPrint Main',
    cupsURL: settings.cupsURL || 'http://localhost:631',
  })

  // Keep form in sync with settings
  useEffect(() => {
    setProfileForm({
      userName: settings.userName || (user?.username === 'admin' ? 'Administrator' : user?.username || 'Andi Ahmad'),
      userEmail: settings.userEmail || (user?.username === 'admin' ? 'admin@kroomprint.app' : 'user@kroomprint.app'),
      workspaceName: settings.workspaceName || 'KroomPrint Main',
      cupsURL: settings.cupsURL || 'http://localhost:631',
    })
  }, [settings, user])

  // Change Password Modal State
  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdForm, setPwdForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' })

  // CUPS Testing State
  const [cupsTesting, setCupsTesting] = useState(false)
  const [cupsTestResult, setCupsTestResult] = useState(null)
  const [editingCups, setEditingCups] = useState(false)
  const [tempCupsUrl, setTempCupsUrl] = useState(settings.cupsURL || 'http://localhost:631')

  // Diagnostics Modal State
  const [diagOpen, setDiagOpen] = useState(false)
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagData, setDiagData] = useState(null)

  // Reset Modal State
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetConfirmed, setResetConfirmed] = useState(false)

  // Handle Notifications Toggle with Browser Permission Request
  const handleToggleNotifications = async (val) => {
    if (val) {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'default') {
          const perm = await Notification.requestPermission()
          if (perm !== 'granted') {
            toast('Izin notifikasi browser belum diberikan', 'info')
          }
        }
      }
    }
    setSettings({ ...settings, notifications: val })
    toast(`Notifikasi job ${val ? 'diaktifkan' : 'dinonaktifkan'}`, 'info')
  }

  // Handle Save Profile
  const handleSaveProfile = async (e) => {
    e?.preventDefault()
    try {
      await setSettings({
        ...settings,
        userName: profileForm.userName,
        userEmail: profileForm.userEmail,
        workspaceName: profileForm.workspaceName,
      })
      setEditingProfile(false)
      toast('Profil workspace berhasil disimpan', 'success')
    } catch (err) {
      toast(`Gagal menyimpan: ${err.message}`, 'error')
    }
  }

  // Handle Save CUPS Endpoint (Admin)
  const handleSaveCups = async (e) => {
    e?.preventDefault()
    try {
      await setSettings({
        ...settings,
        cupsURL: tempCupsUrl,
      })
      setEditingCups(false)
      toast('CUPS server endpoint berhasil diperbarui', 'success')
    } catch (err) {
      toast(`Gagal menyimpan CUPS URL: ${err.message}`, 'error')
    }
  }

  // Handle Test CUPS Connection
  const handleTestCups = async () => {
    setCupsTesting(true)
    setCupsTestResult(null)
    try {
      const res = await testCUPS(tempCupsUrl || settings.cupsURL)
      setCupsTestResult(res)
      if (res.ok) {
        toast(`CUPS Connection OK: ${res.latencyMs?.toFixed(1)} ms latency`, 'success')
      } else {
        toast(`CUPS Unreachable: ${res.error || 'Connection failed'}`, 'error')
      }
    } catch (err) {
      setCupsTestResult({ ok: false, error: err.message })
      toast(`Gagal menguji CUPS: ${err.message}`, 'error')
    } finally {
      setCupsTesting(false)
    }
  }

  // Handle Change Password Submit
  const handleChangePasswordSubmit = async (e) => {
    e.preventDefault()
    if (pwdForm.newPassword.length < 6) {
      toast('Password baru minimal harus 6 karakter', 'error')
      return
    }
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      toast('Konfirmasi password baru tidak cocok', 'error')
      return
    }
    setPwdLoading(true)
    try {
      await changePassword(pwdForm.oldPassword, pwdForm.newPassword)
      setPwdOpen(false)
      setPwdForm({ oldPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) {
      toast(`Gagal mengubah password: ${err.message}`, 'error')
    } finally {
      setPwdLoading(false)
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
      {/* ── Guest Info Banner ── */}
      <Only roles={['guest']}>
        <div className="p-4 rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-vanilla-200 border-2 border-dark-black-900 flex items-center justify-center text-dark-black-900 shrink-0">
              <IconEye size={18} />
            </div>
            <div>
              <div className="font-figtree font-bold text-[14.5px] text-dark-black-900">Guest Mode (Read-Only)</div>
              <div className="font-figtree font-light text-[12.5px] text-dark-black-900/60">
                You are browsing as a guest. Client preferences apply locally in this browser.
              </div>
            </div>
          </div>
          <Button variant="lime" size="sm" onClick={() => openLoginModal('Sign in to manage workspace settings and print documents.')}>
            Sign In
          </Button>
        </div>
      </Only>

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="w-[14px] h-[14px] bg-lime-300 border border-dark-black-900 rounded-[2px] inline-block" />
          <span className="font-geist text-[11px] uppercase tracking-widest text-dark-black-900/60 font-medium">Configuration</span>
        </div>
        <h1 className="font-figtree font-semibold text-[36px] leading-tight text-dark-black-900">Settings</h1>
        <p className="font-figtree font-light text-dark-black-900/60 text-[15px] mt-0.5">
          Application preferences and spooler configuration.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* ── Preferences ── */}
        <Section title="Preferences" desc="Tune how KroomPrint behaves for your workflow and UI theme.">
          <div className="flex flex-col divide-y divide-dark-black-900/10">
            <Toggle
              label="Auto-refresh printer status"
              desc="Poll printer status & queue in real-time background cadence"
              checked={settings.autoRefresh}
              onChange={(v) => {
                setSettings({ ...settings, autoRefresh: v })
                toast(`Auto-refresh ${v ? 'diaktifkan' : 'dinonaktifkan'}`, 'info')
              }}
            />
            <Toggle
              label="Job notifications"
              desc="Trigger native browser & in-app alerts when a job completes or fails"
              checked={settings.notifications}
              onChange={handleToggleNotifications}
            />
            <Toggle
              label="Dark mode (Glassmorphism Dark)"
              desc="Switch interface color theme palette to low-light dark tone"
              checked={settings.darkMode}
              onChange={(v) => {
                setSettings({ ...settings, darkMode: v })
                toast(`Tema ${v ? 'Dark Mode' : 'Light Mode'} diaktifkan`, 'info')
              }}
            />
            <Toggle
              label="Compact queue view"
              desc="Show condensed high-density job table in the active queue page"
              checked={settings.compactQueue}
              onChange={(v) => {
                setSettings({ ...settings, compactQueue: v })
                toast(`Tampilan antrean ${v ? 'Compact' : 'Standard'}`, 'info')
              }}
            />
          </div>
        </Section>

        {/* ── Account & Workspace ── */}
        <Section title="Account & Workspace" desc="Your account profile, role authorization, and workspace identity.">
          <div className="flex items-center gap-4 p-4 rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 mb-5 shadow-xs">
            <div className={`w-14 h-14 rounded-[14px] border-2 border-dark-black-900 flex items-center justify-center font-bold text-dark-black-900 shrink-0 ${
              user?.role === 'admin' ? 'bg-lime-300' : isGuest ? 'bg-vanilla-300' : 'bg-sky-blue-100'
            }`}>
              {user?.role === 'admin' ? (
                <IconCrown size={24} />
              ) : isGuest ? (
                <IconEye size={24} />
              ) : (
                <IconUser size={24} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-figtree font-bold text-[16px] text-dark-black-900 truncate">
                {isGuest ? 'Guest Visitor' : settings.userName || user?.username}
              </div>
              <div className="font-figtree font-light text-dark-black-900/55 text-[13px] truncate">
                {isGuest ? 'Unauthenticated Access' : `@${user?.username} · ${settings.userEmail || `${user?.username}@kroomprint.app`}`}
              </div>
              <div className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full border border-dark-black-900 bg-vanilla-200 text-[11px] font-semibold font-figtree text-dark-black-900">
                <IconGear size={11} /> {settings.workspaceName || 'KroomPrint Main'} · {isGuest ? 'Guest Mode' : user?.role === 'admin' ? 'Workspace Admin' : 'Member'}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 shrink-0">
              {isGuest ? (
                <Button variant="lime" size="sm" onClick={() => openLoginModal('Sign in to your account')}>
                  Sign In
                </Button>
              ) : (
                <>
                  <Button
                    variant={editingProfile ? 'dark' : 'vanilla'}
                    size="sm"
                    onClick={() => setEditingProfile(!editingProfile)}
                  >
                    {editingProfile ? 'Cancel' : 'Edit Profile'}
                  </Button>
                  <Button
                    variant="vanilla"
                    size="sm"
                    onClick={() => setPwdOpen(true)}
                    icon={<IconLock size={12} />}
                  >
                    Password
                  </Button>
                </>
              )}
            </div>
          </div>

          {editingProfile && !isGuest && (
            <form onSubmit={handleSaveProfile} className="flex flex-col gap-3 p-4 rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 mb-4 shadow-xs">
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
              {user?.role === 'admin' && (
                <div>
                  <label className="block font-figtree font-medium text-[12.5px] text-dark-black-900/70 mb-1">Workspace Name (Admin Only)</label>
                  <input
                    type="text"
                    value={profileForm.workspaceName}
                    onChange={(e) => setProfileForm({ ...profileForm, workspaceName: e.target.value })}
                    className="w-full border-2 border-dark-black-900 bg-vanilla-200 rounded-[10px] px-3 py-2 font-figtree text-[13.5px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 mt-2">
                <Button type="button" variant="vanilla" size="sm" onClick={() => setEditingProfile(false)}>Cancel</Button>
                <Button type="submit" variant="lime" size="sm" icon={<IconCheck size={14} />}>Save Changes</Button>
              </div>
            </form>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
              <span className="font-figtree text-[14px] text-dark-black-900">Workspace Role</span>
              <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold font-figtree ${
                user?.role === 'admin' ? 'border-dark-black-900 bg-lime-300 text-dark-black-900' : isGuest ? 'border-dark-black-900/30 bg-vanilla-200 text-dark-black-900/60' : 'border-dark-black-900 bg-sky-blue-100 text-dark-black-900'
              }`}>
                {user?.role === 'admin' ? 'Administrator' : isGuest ? 'Guest' : 'Standard User'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
              <span className="font-figtree text-[14px] text-dark-black-900">Active Printers</span>
              <span className="font-geist text-[12.5px] font-medium text-dark-black-900/70">{printers.length} online</span>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
              <span className="font-figtree text-[14px] text-dark-black-900">Default Destination</span>
              <span className="font-figtree text-[12.5px] font-medium text-dark-black-900/70">{defaultPrinter?.name || '—'}</span>
            </div>
          </div>
        </Section>

        {/* ── CUPS Server & Remote Connectivity ── */}
        <Section title="CUPS & Remote Connectivity" desc="Configure print spooler daemon endpoint and verify socket connectivity.">
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 flex flex-col gap-2 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-figtree text-[11px] uppercase tracking-wider text-dark-black-900/50 font-semibold">Configured CUPS Server</span>
                <Only roles={['admin']}>
                  <button
                    onClick={() => {
                      setEditingCups(!editingCups)
                      setTempCupsUrl(settings.cupsURL || 'http://localhost:631')
                    }}
                    className="text-[12px] font-figtree font-semibold text-dark-black-900 underline hover:text-lime-700 cursor-pointer"
                  >
                    {editingCups ? 'Cancel' : 'Change Endpoint'}
                  </button>
                </Only>
              </div>

              {editingCups && user?.role === 'admin' ? (
                <form onSubmit={handleSaveCups} className="flex flex-col gap-3 mt-1">
                  <input
                    type="text"
                    value={tempCupsUrl}
                    onChange={(e) => setTempCupsUrl(e.target.value)}
                    placeholder="http://127.0.0.1:631"
                    className="w-full border-2 border-dark-black-900 bg-vanilla-200 rounded-[10px] px-3 py-2 font-mono text-[13px] text-dark-black-900 focus:outline-none focus:bg-white"
                    required
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <Button type="button" variant="vanilla" size="sm" onClick={handleTestCups} disabled={cupsTesting} icon={<IconWifi size={13} />}>
                      {cupsTesting ? 'Testing…' : 'Test Ping'}
                    </Button>
                    <Button type="submit" variant="lime" size="sm" icon={<IconCheck size={13} />}>
                      Save Endpoint
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="font-geist text-[14px] text-dark-black-900 font-bold break-all">
                    {settings.cupsURL || 'http://localhost:631'}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="vanilla" size="sm" onClick={handleTestCups} disabled={cupsTesting} icon={<IconWifi size={13} />}>
                      {cupsTesting ? 'Testing…' : 'Test Connection'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Test Result Banner */}
              {cupsTestResult && (
                <div className={`mt-2 p-3 rounded-[10px] border text-[12.5px] font-figtree flex items-center gap-2 ${
                  cupsTestResult.ok ? 'border-ok-500 bg-ok-100 text-ok-700' : 'border-err-500 bg-err-100 text-err-700'
                }`}>
                  {cupsTestResult.ok ? <IconCheckCircle size={15} className="shrink-0" /> : <IconAlert size={15} className="shrink-0" />}
                  <span>
                    {cupsTestResult.ok
                      ? `CUPS Daemon OK (${cupsTestResult.latencyMs?.toFixed(1)} ms latency) · Socket Connected`
                      : cupsTestResult.error || 'Connection refused or timeout'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5 p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100 text-[12.5px] font-figtree text-dark-black-900/70">
              <IconCheckCircle size={16} className="text-ok-500 shrink-0" />
              <span>IPP Everywhere, AirPrint raster, and ESC/P-R USB drivers active.</span>
            </div>
          </div>
        </Section>

        {/* ── Diagnostics ── */}
        <Section title="Diagnostics & Maintenance" desc="Live connectivity tests, socket latency measurements, and spool health.">
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
              <IconWifi size={16} /> Run Full Network & CUPS Diagnostics
            </button>
            <div className="flex items-center gap-2 p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100 text-[12.5px] font-figtree text-dark-black-900/70">
              <IconAlert size={15} className="text-warn-500 shrink-0" />
              Real-time hardware status and IPP counters are verified automatically.
            </div>
          </div>
        </Section>

        {/* ── Danger Zone (Admin Only) ── */}
        <Only roles={['admin']}>
          <div className="xl:col-span-2">
            <Section title="Danger Zone" desc="Destructive workspace operations — strictly restricted to administrators.">
              <div className="flex items-center justify-between gap-4 p-4 rounded-[14px] border-2 border-err-500 bg-err-100 flex-wrap sm:flex-nowrap shadow-xs">
                <div>
                  <div className="font-figtree font-bold text-[15px] text-err-500">Reset All Workspace Data</div>
                  <div className="font-figtree font-light text-err-500/80 text-[13px] mt-0.5">
                    Purges active print queues, deletes all print history records, and restores factory default settings.
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
        </Only>
      </div>

      {/* ── Change Password Modal ── */}
      <Modal
        open={pwdOpen}
        onClose={() => setPwdOpen(false)}
        title="Change Account Password"
        subtitle={`Update password for ${user?.username || 'your account'}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="vanilla" size="sm" onClick={() => setPwdOpen(false)}>Cancel</Button>
            <Button
              variant="lime"
              size="sm"
              onClick={handleChangePasswordSubmit}
              disabled={pwdLoading}
              icon={<IconCheck size={14} />}
            >
              {pwdLoading ? 'Saving…' : 'Update Password'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleChangePasswordSubmit} className="flex flex-col gap-3.5">
          <div>
            <label className="block font-figtree font-bold text-[13px] text-dark-black-900 mb-1">Current Password</label>
            <input
              type="password"
              value={pwdForm.oldPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, oldPassword: e.target.value })}
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-2 font-mono text-[13.5px] focus:outline-none focus:bg-white"
              placeholder="••••••••"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block font-figtree font-bold text-[13px] text-dark-black-900 mb-1">New Password (Min 6 chars)</label>
            <input
              type="password"
              value={pwdForm.newPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-2 font-mono text-[13.5px] focus:outline-none focus:bg-white"
              placeholder="••••••••"
              required
            />
          </div>
          <div>
            <label className="block font-figtree font-bold text-[13px] text-dark-black-900 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={pwdForm.confirmPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-2 font-mono text-[13.5px] focus:outline-none focus:bg-white"
              placeholder="••••••••"
              required
            />
          </div>
        </form>
      </Modal>

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
                      <div className="font-geist text-[11px] text-dark-black-900/50 truncate">
                        {p.address?.startsWith('usb://') || p.connection === 'USB' ? 'USB Direct (Local Port)' : (p.address || 'Local Port')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-geist text-[12px] font-medium text-dark-black-900/70">{p.latencyMs?.toFixed(1)} ms</span>
                      <span className={`px-2 py-0.5 rounded-full border border-dark-black-900 text-[11px] font-bold ${
                        p.online ? 'bg-lime-300 text-dark-black-900' : 'bg-err-100 text-err-600'
                      }`}>
                        {p.online ? 'Online' : 'Offline'}
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
