import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import Modal from '../ui/Modal'
import {
  IconHistory, IconPlus, IconTrash, IconKey, IconCheck, IconAlert,
  IconCrown, IconUser, IconEye, IconX,
} from '../ui/icons'

const ROLES = ['admin', 'user', 'guest']

const ROLE_BADGES = {
  admin: { label: 'Administrator', icon: IconCrown, bg: 'bg-lime-300 border-dark-black-900 text-dark-black-900', desc: 'Full System Access' },
  user: { label: 'Standard User', icon: IconUser, bg: 'bg-sky-blue-100 border-dark-black-900 text-dark-black-900', desc: 'Print & Queue Management' },
  guest: { label: 'Guest', icon: IconEye, bg: 'bg-vanilla-300 border-dark-black-900 text-dark-black-900', desc: 'Read-only Monitoring' },
}

export default function UsersPage() {
  const { toast } = useApp()
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'user' })
  const [showForm, setShowForm] = useState(false)

  // Reset Password Modal State
  const [resetTarget, setResetTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetting, setResetting] = useState(false)

  const reload = useCallback(async () => {
    try {
      setUsers(await api.listUsers())
    } catch (e) {
      toast(e.message, 'error')
    }
  }, [toast])

  useEffect(() => { reload() }, [reload])

  const createUser = async (e) => {
    e.preventDefault()
    if (!form.username.trim() || !form.password.trim()) {
      toast('Username and password are required', 'error')
      return
    }
    setBusy(true)
    try {
      await api.createUser(form)
      toast(`User "${form.username}" created successfully`, 'success')
      setForm({ username: '', password: '', role: 'user' })
      setShowForm(false)
      await reload()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const setRole = async (u, role) => {
    try {
      await api.updateUser(u.id, { role })
      toast(`${u.username} is now ${role}`, 'success')
      await reload()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const submitResetPassword = async (e) => {
    e?.preventDefault()
    if (!newPassword || newPassword.length < 6) {
      toast('Password must be at least 6 characters', 'error')
      return
    }
    setResetting(true)
    try {
      await api.updateUser(resetTarget.id, { password: newPassword })
      toast(`Password for ${resetTarget.username} updated successfully!`, 'success')
      setResetTarget(null)
      setNewPassword('')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setResetting(false)
    }
  }

  const removeUser = async (u) => {
    if (!window.confirm(`Are you sure you want to delete user "${u.username}"?`)) return
    try {
      await api.deleteUser(u.id)
      toast(`Deleted account ${u.username}`, 'success')
      await reload()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  return (
    <div className="flex flex-col gap-7">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-[14px] h-[14px] bg-lime-300 border border-dark-black-900 rounded-[2px] inline-block" />
            <span className="font-geist text-[11px] uppercase tracking-widest text-dark-black-900/60 font-medium">Access Control</span>
          </div>
          <h1 className="font-figtree font-semibold text-[36px] leading-tight text-dark-black-900">Users &amp; Roles</h1>
          <p className="font-figtree font-light text-dark-black-900/60 text-[15px] mt-0.5">
            Manage user accounts, assign role permissions, and reset authentication credentials.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-400 font-figtree font-bold text-[14px] text-dark-black-900 shadow-[3px_3px_0_0_rgba(56,56,56,1)] transition-all cursor-pointer"
        >
          {showForm ? <><IconX size={15} /> Cancel</> : <><IconPlus size={15} /> Add New User</>}
        </button>
      </div>

      {/* Role Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {ROLES.map((r) => {
          const badge = ROLE_BADGES[r]
          const RoleIcon = badge.icon
          const count = users.filter((u) => u.role === r).length
          return (
            <div key={r} className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[18px] p-4 flex flex-col gap-1 shadow-sm">
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border text-[11.5px] font-bold font-figtree ${badge.bg}`}>
                  <RoleIcon size={13} />
                  <span>{badge.label}</span>
                </span>
                <span className="font-geist font-bold text-[18px] text-dark-black-900">{count}</span>
              </div>
              <div className="font-figtree font-light text-dark-black-900/60 text-[12.5px] mt-2">
                {badge.desc}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add User Form Drawer */}
      {showForm && (
        <form onSubmit={createUser} className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[20px] p-6 shadow-[4px_4px_0_0_rgba(56,56,56,1)] flex flex-col gap-4 modal-in">
          <div className="absolute -top-[9px] -right-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-lime-300 rounded-[2px] pointer-events-none" />
          <div className="font-figtree font-bold text-[18px] text-dark-black-900">Create New Account</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-figtree text-[13px] font-semibold text-dark-black-900">Username</span>
              <input
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="e.g. johan"
                className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] px-3.5 py-2.5 font-figtree text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-figtree text-[13px] font-semibold text-dark-black-900">Password (min 6 chars)</span>
              <input
                required
                minLength={6}
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] px-3.5 py-2.5 font-figtree text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-figtree text-[13px] font-semibold text-dark-black-900">Role Permission</span>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] px-3.5 py-2.5 font-figtree text-[14px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30 cursor-pointer"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r.toUpperCase()}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 font-figtree font-semibold text-[13.5px] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-6 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-dark-black-900 text-vanilla-100 font-figtree font-bold text-[14px] hover:bg-lime-300 hover:text-dark-black-900 transition-colors cursor-pointer disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Save Account'}
            </button>
          </div>
        </form>
      )}

      {/* Users Table */}
      <div className="relative bg-vanilla-200 border-2 border-dark-black-900 rounded-[20px] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-dark-black-900 bg-vanilla-300/70">
                <th className="px-6 py-3.5 font-figtree text-[13px] font-bold uppercase tracking-wider text-dark-black-900">User Account</th>
                <th className="px-6 py-3.5 font-figtree text-[13px] font-bold uppercase tracking-wider text-dark-black-900">Assigned Role</th>
                <th className="px-6 py-3.5 font-figtree text-[13px] font-bold uppercase tracking-wider text-dark-black-900 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const badge = ROLE_BADGES[u.role] || ROLE_BADGES.guest
                const RoleIcon = badge.icon
                return (
                  <tr key={u.id} className="border-b border-dark-black-900/15 last:border-0 hover:bg-vanilla-100/60 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-[11px] border-2 border-dark-black-900 flex items-center justify-center text-dark-black-900 ${badge.bg.split(' ')[0]} shadow-xs`}>
                          <RoleIcon size={18} />
                        </div>
                        <div>
                          <div className="font-figtree font-bold text-[15px] text-dark-black-900 flex items-center gap-2">
                            <span>{u.username}</span>
                            {me?.username === u.username && (
                              <span className="px-2 py-0.5 rounded-[5px] bg-lime-300 border border-dark-black-900 text-[10px] font-geist font-bold">
                                YOU
                              </span>
                            )}
                          </div>
                          <div className="font-geist text-[11px] text-dark-black-900/50">ID: {u.id.slice(0, 8)}…</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={u.role}
                        onChange={(e) => setRole(u, e.target.value)}
                        disabled={u.username === 'admin'}
                        className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-1.5 font-figtree text-[13px] font-semibold text-dark-black-900 disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r.toUpperCase()}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setResetTarget(u); setNewPassword(''); }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 font-figtree text-[13px] font-semibold text-dark-black-900 transition-colors cursor-pointer"
                        >
                          <IconKey size={14} />
                          <span>Reset Password</span>
                        </button>
                        <button
                          onClick={() => removeUser(u)}
                          disabled={u.username === 'admin' || me?.username === u.username}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-err-100 hover:text-err-500 font-figtree text-[13px] font-semibold text-dark-black-900 transition-colors cursor-pointer disabled:opacity-30 disabled:hover:bg-vanilla-100 disabled:hover:text-dark-black-900"
                        >
                          <IconTrash size={14} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-10 text-center font-figtree text-[14px] text-dark-black-900/50">
                    No users found in database.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Password Reset Modal */}
      {resetTarget && (
        <Modal open={true} onClose={() => setResetTarget(null)} title={`Reset Password: ${resetTarget.username}`}>
          <form onSubmit={submitResetPassword} className="flex flex-col gap-4">
            <p className="font-figtree font-light text-dark-black-900/70 text-[14px]">
              Enter a new secure password for user <b>{resetTarget.username}</b> (minimum 6 characters).
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="font-figtree text-[13px] font-semibold text-dark-black-900">New Password</span>
              <input
                autoFocus
                required
                minLength={6}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border-2 border-dark-black-900 bg-vanilla-100 rounded-[12px] px-4 py-3 font-figtree text-[14.5px] text-dark-black-900 focus:outline-none focus:bg-lime-300/30"
              />
            </label>
            <div className="flex justify-end gap-3 pt-3 border-t border-dark-black-900/10">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="px-4 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-vanilla-300 font-figtree font-semibold text-[13.5px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetting}
                className="px-6 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-400 font-figtree font-bold text-[14px] text-dark-black-900 cursor-pointer disabled:opacity-60 shadow-sm"
              >
                {resetting ? 'Updating…' : 'Save New Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
