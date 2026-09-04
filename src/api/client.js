// ─────────────────────────────────────────────
// KroomPrint API client — semua data dari backend Go
// ─────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8088` : 'http://localhost:8088')

const TOKEN_KEY = 'kroomprint_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

function authHeaders(extra = {}) {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}`, ...extra } : extra
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) {
    let msg = `API error ${res.status}`
    try {
      const data = await res.json()
      if (data?.error) msg = data.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // Preview
  convertForPreview: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/api/convert/preview`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    }).then(async (res) => {
      if (!res.ok) {
        let msg = `Preview conversion error ${res.status}`
        try {
          const data = await res.json()
          if (data?.error) msg = data.error
        } catch {}
        throw new Error(msg)
      }
      return res.blob()
    })
  },

  // Health
  health: () => request('/api/health'),

  // Printers
  listPrinters: () => request('/api/printers'),
  getPrinter: (id) => request(`/api/printers/${id}`),
  addPrinter: (payload) => request('/api/printers', { method: 'POST', body: JSON.stringify(payload) }),
  renamePrinter: (id, name) => request(`/api/printers/${id}/rename`, { method: 'POST', body: JSON.stringify({ name }) }),
  deletePrinter: (id) => request(`/api/printers/${id}`, { method: 'DELETE' }),
  refreshPrinter: (id) => request(`/api/printers/${id}/refresh`, { method: 'POST' }),
  testPrint: (id) => request(`/api/printers/${id}/test`, { method: 'POST' }),
  pausePrinter: (id) => request(`/api/printers/${id}/pause`, { method: 'POST' }),
  resumePrinter: (id) => request(`/api/printers/${id}/resume`, { method: 'POST' }),
  enablePrinter: (id) => request(`/api/printers/${id}/enable`, { method: 'POST' }),
  disablePrinter: (id) => request(`/api/printers/${id}/disable`, { method: 'POST' }),
  setDefaultPrinter: (id) => request(`/api/printers/${id}/default`, { method: 'POST' }),
  getPrinterHealth: (id) => request(`/api/printers/${id}/health`),
  getPPDOptions: (id) => request(`/api/printers/${id}/ppd-options`),
  cleanHead: (id) => request(`/api/printers/${id}/maintenance/clean-head`, { method: 'POST' }),
  nozzleCheck: (id) => request(`/api/printers/${id}/maintenance/nozzle-check`, { method: 'POST' }),

  // Discovery
  scan: () => request('/api/discovery/scan', { method: 'POST' }),
  discoveryResults: () => request('/api/discovery/results'),
  addDiscovered: (id) => request(`/api/discovery/${id}/add`, { method: 'POST' }),
  deleteDiscovered: (id) => request(`/api/discovery/${id}`, { method: 'DELETE' }),

  // Jobs
  listJobs: () => request('/api/jobs'),
  createJob: (payload, file) => {
    // Jika ada File, kirim multipart (upload + submit CUPS)
    if (file) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('job', JSON.stringify(payload))
      return fetch(`${BASE}/api/jobs`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      }).then(async (res) => {
        if (!res.ok) {
          let msg = `API error ${res.status}`
          try {
            const data = await res.json()
            if (data?.error) msg = data.error
          } catch {}
          throw new Error(msg)
        }
        return res.json()
      })
    }
    return request('/api/jobs', { method: 'POST', body: JSON.stringify(payload) })
  },
  cancelJob: (id) => request(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  pauseJob: (id) => request(`/api/jobs/${id}/pause`, { method: 'POST' }),
  resumeJob: (id) => request(`/api/jobs/${id}/resume`, { method: 'POST' }),
  retryJob: (id) => request(`/api/jobs/${id}/retry`, { method: 'POST' }),
  releaseSecureJob: (id, pin) => request(`/api/jobs/${id}/release`, { method: 'POST', body: JSON.stringify({ pin }) }),
  rerouteJob: (id, printerId) => request(`/api/jobs/${id}/reroute`, { method: 'POST', body: JSON.stringify({ printerId }) }),
  purgeJob: (id) => request(`/api/jobs/${id}/purge`, { method: 'POST' }),
  reorderJobs: (jobIds) => request('/api/jobs/reorder', { method: 'POST', body: JSON.stringify({ jobIds }) }),
  setJobPriority: (id, priority) => request(`/api/jobs/${id}/priority`, { method: 'POST', body: JSON.stringify({ priority }) }),

  // History & Analytics
  listHistory: (params = {}) => {
    const q = new URLSearchParams()
    if (params.all) q.set('all', 'true')
    if (params.user) q.set('user', params.user)
    const qs = q.toString()
    return request(`/api/history${qs ? `?${qs}` : ''}`)
  },
  clearHistory: () => request('/api/history', { method: 'DELETE' }),
  getAnalyticsSummary: () => request('/api/analytics/summary'),
  getAnalyticsExportUrl: (format = 'csv') => `${BASE}/api/analytics/export?format=${format}`,

  // Settings & Diagnostics
  getSettings: () => request('/api/settings'),
  putSettings: (payload) => request('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testCUPSConnection: (cupsURL) => request('/api/settings/test-cups', { method: 'POST', body: JSON.stringify({ cupsURL }) }),
  getDiagnostics: () => request('/api/diagnostics/network'),
  resetAllData: () => request('/api/settings/reset', { method: 'POST' }),

  // Real-Time SSE Streaming
  subscribeEvents: (onMessage) => {
    try {
      const t = encodeURIComponent(getToken())
      const es = new EventSource(`${BASE}/api/events${t ? `?token=${t}` : ''}`)
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (onMessage) onMessage(data)
        } catch {}
      }
      es.addEventListener('job_created', (e) => {
        try {
          const data = JSON.parse(e.data)
          if (onMessage) onMessage({ type: 'job_created', ...data })
        } catch {}
      })
      es.addEventListener('job_updated', (e) => {
        try {
          const data = JSON.parse(e.data)
          if (onMessage) onMessage({ type: 'job_updated', ...data })
        } catch {}
      })
      es.addEventListener('job_completed', (e) => {
        try {
          const data = JSON.parse(e.data)
          if (onMessage) onMessage({ type: 'job_completed', ...data })
        } catch {}
      })
      return () => es.close()
    } catch {
      return () => {}
    }
  },

  // ── Auth & Users ──
  login: async (username, password) => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setToken(res.token || '')
    return res
  },
  me: () => request('/api/auth/me'),
  changePassword: (oldPassword, newPassword) =>
    request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }),
  listUsers: () => request('/api/users'),
  createUser: (payload) => request('/api/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id, patch) => request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
}
