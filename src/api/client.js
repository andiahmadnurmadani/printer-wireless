// ─────────────────────────────────────────────
// KroomPrint API client — semua data dari backend Go
// ─────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8088` : 'http://localhost:8088')

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
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
  reorderJobs: (jobIds) => request('/api/jobs/reorder', { method: 'POST', body: JSON.stringify({ jobIds }) }),
  setJobPriority: (id, priority) => request(`/api/jobs/${id}/priority`, { method: 'POST', body: JSON.stringify({ priority }) }),

  // History
  listHistory: () => request('/api/history'),
  clearHistory: () => request('/api/history', { method: 'DELETE' }),

  // Settings
  getSettings: () => request('/api/settings'),
  putSettings: (payload) => request('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
}
