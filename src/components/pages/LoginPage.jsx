import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { IconPrinter, IconWifi, IconArrowRight } from '../ui/icons'

/**
 * Login screen — KroomPrint branding, Bugster design language.
 */
export default function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password.trim()) {
      setError('Please enter your username and password.')
      return
    }
    setLoading(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err.message || 'Sign-in failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-kroom-noise relative flex items-center justify-center p-6">
      {/* Decorative squares */}
      <span className="sq-anim-loop absolute top-[12%] left-[10%] w-[23px] h-[23px] rounded-[2px] border border-dark-black-900 bg-lime-300 pointer-events-none" />
      <span className="sq-anim-loop absolute bottom-[15%] left-[22%] w-[23px] h-[23px] rounded-[2px] border border-dark-black-900 bg-lime-300 pointer-events-none" style={{ animationDelay: '2s' }} />
      <span className="sq-anim-loop absolute top-[20%] right-[12%] w-[23px] h-[23px] rounded-[2px] border border-dark-black-900 bg-lime-300 pointer-events-none" style={{ animationDelay: '3.5s' }} />
      <span className="sq-anim-loop absolute bottom-[22%] right-[20%] w-[23px] h-[23px] rounded-[2px] border border-dark-black-900 bg-lime-300 pointer-events-none" style={{ animationDelay: '1.2s' }} />

      <div className="w-full max-w-[420px]">
        {/* Brand */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-[14px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center text-dark-black-900 relative">
            <IconPrinter size={26} />
            <span className="absolute -top-[5px] -right-[5px] w-[11px] h-[11px] bg-sky-blue-500 border border-dark-black-900 rounded-[2px]" />
          </div>
          <div className="leading-tight">
            <div className="font-figtree font-bold text-[24px] text-dark-black-900 tracking-tight">KroomPrint</div>
            <div className="font-geist text-[11px] text-dark-black-900/50 uppercase tracking-widest">Wireless Print</div>
          </div>
        </div>

        {/* Card */}
        <div className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[24px] p-8 shadow-xl">
          <div className="absolute -top-[9px] -left-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />
          <div className="absolute -bottom-[9px] -right-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />

          <h1 className="font-figtree font-semibold text-[26px] text-dark-black-900">Sign in to KroomPrint</h1>
          <p className="font-figtree font-light text-dark-black-900/55 text-[14px] mt-1 mb-7">
            Access your wireless printers from anywhere.
          </p>

          {error && (
            <div className="mb-5 p-3.5 rounded-[12px] border-2 border-err-500 bg-err-100 font-figtree text-[13px] font-medium text-err-500">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-figtree text-[13px] font-medium text-dark-black-900">Username</span>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] px-4 py-3 font-figtree text-[14.5px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-figtree text-[13px] font-medium text-dark-black-900">Password</span>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] px-4 py-3 pr-14 font-figtree text-[14.5px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 font-geist text-[11px] font-semibold text-dark-black-900/60 hover:text-dark-black-900 cursor-pointer px-2 py-1"
                >
                  {showPass ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-[13px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-500 transition-all font-figtree font-bold text-[15px] text-dark-black-900 cursor-pointer disabled:opacity-60 shadow-[3px_3px_0_0_rgba(56,56,56,1)]"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-dark-black-900 border-t-transparent rounded-full animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in <IconArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 font-figtree text-[12.5px] text-dark-black-900/60 text-center">
            <IconWifi size={14} className="text-dark-black-900/40 shrink-0" />
            Devices on your network appear automatically after sign-in.
          </div>
        </div>

        <p className="text-center mt-6 font-geist text-[11px] text-dark-black-900/40 uppercase tracking-widest">
          KroomPrint · Wireless printing, simplified
        </p>
      </div>
    </div>
  )
}
