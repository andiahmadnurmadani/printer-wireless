import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'

const ROLES = ['admin', 'user', 'guest']

export default function UsersPage() {
  const { toast } = useApp()
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'guest' })
  const [showForm, setShowForm] = useState(false)

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
    setBusy(true)
    try {
      await api.createUser(form)
      toast(`User "${form.username}" created`, 'success')
      setForm({ username: '', password: '', role: 'guest' })
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

  const resetPassword = async (u) => {
    const pw = window.prompt(`New password for ${u.username} (min 6 chars):`)
    if (!pw) return
    try {
      await api.updateUser(u.id, { password: pw })
      toast(`Password updated for ${u.username}`, 'success')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const removeUser = async (u) => {
    if (!window.confirm(`Delete account "${u.username}"?`)) return
    try {
      await api.deleteUser(u.id)
      toast(`Deleted ${u.username}`, 'success')
      await reload()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-figtree font-bold text-[26px] text-dark-black-900">Users &amp; Roles</h1>
          <p className="font-figtree text-dark-black-900/55 text-[14px] mt-1">
            admin = full control · user = print &amp; queue · guest = read-only
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-5 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-500 font-figtree font-bold text-[14px] cursor-pointer"
        >
          {showForm ? 'Close' : '+ Add User'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createUser} className="mb-6 p-5 rounded-[16px] border-2 border-dark-black-900 bg-vanilla-200 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="font-figtree text-[12px] font-medium">Username</span>
            <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-2 font-figtree text-[14px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-figtree text-[12px] font-medium">Password (min 6)</span>
            <input required minLength={6} type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-2 font-figtree text-[14px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-figtree text-[12px] font-medium">Role</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[10px] px-3 py-2 font-figtree text-[14px]">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy}
            className="px-4 py-2.5 rounded-[10px] border-2 border-dark-black-900 bg-dark-black-900 text-vanilla-100 font-figtree font-bold text-[14px] cursor-pointer disabled:opacity-60">
            Create
          </button>
        </form>
      )}

      <div className="rounded-[16px] border-2 border-dark-black-900 bg-vanilla-200 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b-2 border-dark-black-900 bg-vanilla-300/60">
              <th className="px-5 py-3 font-figtree text-[12.5px] uppercase tracking-wide">User</th>
              <th className="px-5 py-3 font-figtree text-[12.5px] uppercase tracking-wide">Role</th>
              <th className="px-5 py-3 font-figtree text-[12.5px] uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-dark-black-900/15 last:border-0">
                <td className="px-5 py-3 font-figtree text-[14.5px] font-medium">
                  {u.username}{me?.username === u.username && <span className="ml-2 text-[11px] font-geist text-dark-black-900/50">(you)</span>}
                </td>
                <td className="px-5 py-3">
                  <select
                    value={u.role}
                    onChange={(e) => setRole(u, e.target.value)}
                    disabled={u.username === 'admin'}
                    className="border-2 border-dark-black-900 bg-vanilla-100 rounded-[8px] px-2 py-1 font-figtree text-[13px] disabled:opacity-50"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-5 py-3 flex gap-2">
                  <button onClick={() => resetPassword(u)}
                    className="px-3 py-1.5 rounded-[8px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-lime-300 font-figtree text-[12.5px] font-semibold cursor-pointer">
                    Reset Password
                  </button>
                  <button
                    onClick={() => removeUser(u)}
                    disabled={u.username === 'admin' || me?.username === u.username}
                    className="px-3 py-1.5 rounded-[8px] border-2 border-dark-black-900 bg-vanilla-100 hover:bg-err-100 font-figtree text-[12.5px] font-semibold cursor-pointer disabled:opacity-40"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} className="px-5 py-6 font-figtree text-[14px] text-dark-black-900/50">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
