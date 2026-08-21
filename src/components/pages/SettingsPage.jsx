import { useApp } from '../../context/AppContext'
import Button from '../ui/Button'
import { IconGear, IconRefresh, IconAlert } from '../ui/icons'

function Toggle({ label, desc, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 w-full text-left py-2.5 cursor-pointer group"
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
  const { settings, setSettings, printers, defaultPrinter, toast, refreshAll } = useApp()

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
        {/* Preferences */}
        <Section title="Preferences" desc="Tune how KroomPrint behaves for your workflow.">
          <div className="flex flex-col divide-y divide-dark-black-900/10">
            <Toggle label="Auto-refresh printer status" desc="Poll printer status every 30 seconds" checked={settings.autoRefresh} onChange={(v) => setSettings({ ...settings, autoRefresh: v })} />
            <Toggle label="Job notifications" desc="Notify when a job completes or fails" checked={settings.notifications} onChange={(v) => setSettings({ ...settings, notifications: v })} />
            <Toggle label="Dark mode" desc="Coming soon — switch to a darker theme" checked={settings.darkMode} onChange={(v) => { setSettings({ ...settings, darkMode: v }); toast('Dark mode coming soon', 'info') }} />
            <Toggle label="Compact queue view" desc="Show more jobs per row in the queue" checked={settings.compactQueue} onChange={(v) => setSettings({ ...settings, compactQueue: v })} />
          </div>
        </Section>

        {/* Account */}
        <Section title="Account" desc="Your profile and role in this workspace.">
          <div className="flex items-center gap-4 p-4 rounded-[14px] border-2 border-dark-black-900 bg-vanilla-100 mb-5">
            <div className="w-14 h-14 rounded-[14px] bg-lime-300 border-2 border-dark-black-900 flex items-center justify-center font-bold text-[18px] text-dark-black-900">
              AA
            </div>
            <div>
              <div className="font-figtree font-bold text-[16px] text-dark-black-900">Andi Ahmad</div>
              <div className="font-figtree font-light text-dark-black-900/55 text-[13px]">andi@kroomprint.app</div>
              <div className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full border border-dark-black-900 bg-lime-300 text-[11px] font-semibold font-figtree text-dark-black-900">
                <IconGear size={11} /> Owner — full access
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
              <span className="font-figtree text-[14px] text-dark-black-900">Plan</span>
              <span className="font-geist text-[12.5px] font-medium text-dark-black-900/70">KroomPrint Pro</span>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
              <span className="font-figtree text-[14px] text-dark-black-900">Registered printers</span>
              <span className="font-geist text-[12.5px] font-medium text-dark-black-900/70">{printers.length}</span>
            </div>
            <div className="flex items-center justify-between p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100">
              <span className="font-figtree text-[14px] text-dark-black-900">Default printer</span>
              <span className="font-figtree text-[12.5px] font-medium text-dark-black-900/70">{defaultPrinter?.name}</span>
            </div>
          </div>
        </Section>

        {/* Diagnostics */}
        <Section title="Diagnostics" desc="Check connectivity and run maintenance.">
          <div className="flex flex-col gap-3">
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-500 transition-all font-figtree font-semibold text-[14px] text-dark-black-900 cursor-pointer w-full justify-center"
            >
              <IconRefresh size={16} /> Refresh all printer statuses
            </button>
            <button
              onClick={() => toast('Network scan started', 'info')}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 transition-all font-figtree font-semibold text-[14px] text-dark-black-900 cursor-pointer w-full justify-center"
            >
              <IconGear size={16} /> Run network diagnostics
            </button>
            <div className="flex items-center gap-2 p-3.5 rounded-[12px] border border-dark-black-900/20 bg-vanilla-100 text-[12.5px] font-figtree text-dark-black-900/70">
              <IconAlert size={15} className="text-warn-500 shrink-0" />
              Firmware & driver versions are checked automatically on connect.
            </div>
          </div>
        </Section>

        {/* Danger zone */}
        <Section title="Danger zone" desc="Destructive actions — use with care.">
          <div className="flex items-center justify-between gap-4 p-4 rounded-[14px] border-2 border-err-500 bg-err-100">
            <div>
              <div className="font-figtree font-semibold text-[14.5px] text-err-500">Reset all data</div>
              <div className="font-figtree font-light text-err-500/70 text-[12.5px]">Remove all printers, jobs and history</div>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (window.confirm('Reset ALL KroomPrint data? This cannot be undone.')) {
                  toast('Data reset (demo)', 'warn')
                }
              }}
            >
              Reset
            </Button>
          </div>
        </Section>
      </div>
    </div>
  )
}
