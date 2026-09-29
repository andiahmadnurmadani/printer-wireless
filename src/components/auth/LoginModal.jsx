import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { IconPrinter, IconArrowRight, IconX } from '../ui/icons'

export default function LoginModal() {
  const { loginModalOpen, loginModalMsg, closeLoginModal, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!loginModalOpen) return null

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!username.trim() || !password.trim()) {
      setError('Please enter your username and password.')
      return
    }
    setLoading(true)
    try {
      await login(username.trim(), password)
      closeLoginModal()
      setUsername('')
      setPassword('')
    } catch (err) {
      setError(err.message || 'Sign-in failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-dark-black-900/60 backdrop-blur-[4px] transition-opacity"
        onClick={closeLoginModal}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-[440px] bg-vanilla-200 border-2 border-dark-black-900 rounded-[24px] p-6 sm:p-8 shadow-[6px_6px_0_0_rgba(56,56,56,1)] z-10 modal-in">
        {/* Geometric Corner Accents */}
        <span className="absolute -top-[8px] -left-[8px] w-[16px] h-[16px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />
        <span className="absolute -bottom-[8px] -right-[8px] w-[16px] h-[16px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />

        {/* Close Button */}
        <button
          type="button"
          onClick={closeLoginModal}
          className="absolute top-5 right-5 w-8 h-8 rounded-[10px] border border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 flex items-center justify-center text-dark-black-900 cursor-pointer transition-colors"
          title="Close modal"
        >
          <IconX size={16} />
        </button>

        {/* Brand Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-[13px] border-2 border-dark-black-900 bg-lime-300 flex items-center justify-center text-dark-black-900 relative shrink-0">
            <IconPrinter size={24} />
            <span className="absolute -top-[4px] -right-[4px] w-[9px] h-[9px] bg-sky-blue-500 border border-dark-black-900 rounded-[2px]" />
          </div>
          <div>
            <h2 className="font-figtree font-bold text-[22px] text-dark-black-900 tracking-tight leading-tight">
              Sign in to KroomPrint
            </h2>
            <p className="font-figtree font-light text-dark-black-900/60 text-[13px]">
              {loginModalMsg || 'Sign in to access your wireless printers and personal history.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-[12px] border-2 border-err-500 bg-err-100 font-figtree text-[13px] font-medium text-err-500">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1">
            <span className="font-figtree text-[12.5px] font-medium text-dark-black-900">Username</span>
            <input
              id="modal-username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Kolab"
              className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] px-3.5 py-2.5 font-figtree text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-figtree text-[12.5px] font-medium text-dark-black-900">Password</span>
            <div className="relative">
              <input
                id="modal-password"
                name="password"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] px-3.5 py-2.5 pr-14 font-figtree text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 transition-colors placeholder:text-dark-black-900/30"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 font-geist text-[10.5px] font-semibold text-dark-black-900/60 hover:text-dark-black-900 cursor-pointer px-2 py-1"
              >
                {showPass ? 'HIDE' : 'SHOW'}
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-400 transition-all font-figtree font-bold text-[14.5px] text-dark-black-900 cursor-pointer disabled:opacity-60 shadow-[3px_3px_0_0_rgba(56,56,56,1)]"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-dark-black-900 border-t-transparent rounded-full animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign in <IconArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
