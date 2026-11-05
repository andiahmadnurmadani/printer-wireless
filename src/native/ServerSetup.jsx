import { useState } from 'react'
import { normalizeServerUrl, pingServer, setServerUrl } from './server'

/**
 * Layar pertama aplikasi Android: pengguna mengisi alamat backend
 * KroomPrint sebelum dashboard dimuat.
 */
export default function ServerSetup() {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    let url
    try {
      url = normalizeServerUrl(value)
    } catch {
      setError('Alamat tidak valid. Contoh: 100.90.80.85:8088')
      return
    }
    if (!url) {
      setError('Isi alamat server dulu.')
      return
    }
    setChecking(true)
    try {
      await pingServer(url)
      setServerUrl(url)
      window.location.reload()
    } catch {
      setError('Server tidak bisa dihubungi. Pastikan HP satu jaringan (atau Tailscale aktif) dan alamatnya benar.')
      setChecking(false)
    }
  }

  return (
    <div className="min-h-full bg-kroom-noise flex items-center justify-center px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-[400px] bg-vanilla-100 border-2 border-dark-black-900 rounded-[20px] p-6 shadow-[4px_4px_0_0_rgba(56,56,56,1)] flex flex-col gap-4"
      >
        <div className="flex items-center gap-3">
          <img src="/kroomprint.svg" alt="" className="w-11 h-11" />
          <div className="leading-tight">
            <div className="font-figtree font-bold text-[20px] text-dark-black-900">KroomPrint</div>
            <div className="font-geist text-[11px] uppercase tracking-widest text-dark-black-900/60">Hubungkan server</div>
          </div>
        </div>
        <p className="text-[14px] text-dark-black-900/80 m-0">
          Masukkan alamat server KroomPrint di kantor kamu. Tanyakan ke admin kalau belum tahu.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="font-geist text-[11px] uppercase tracking-wider font-semibold text-dark-black-900/70">Alamat server</span>
          <input
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="100.90.80.85:8088"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError('')
            }}
            className="h-[46px] px-3 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-200 font-geist text-[15px] text-dark-black-900 outline-none focus:bg-lime-300/40"
          />
        </label>
        {error && <p className="text-[13px] text-err-500 m-0">{error}</p>}
        <button
          type="submit"
          disabled={checking}
          className="h-[48px] rounded-[13px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-400 font-figtree font-bold text-[15px] text-dark-black-900 cursor-pointer shadow-[3px_3px_0_0_rgba(56,56,56,1)] active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-60"
        >
          {checking ? 'Mengecek server…' : 'Hubungkan'}
        </button>
      </form>
    </div>
  )
}
