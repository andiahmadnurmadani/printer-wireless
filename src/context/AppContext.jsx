import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'

const AppContext = createContext(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

const normalizeSettings = (st = {}) => ({
  autoRefresh: st.autoRefresh === true || st.autoRefresh === 'true',
  notifications: st.notifications !== false && st.notifications !== 'false',
  darkMode: st.darkMode === true || st.darkMode === 'true',
  compactQueue: st.compactQueue === true || st.compactQueue === 'true',
  userName: st.userName || 'Andi Ahmad',
  userEmail: st.userEmail || 'andi@kroomprint.app',
  workspaceName: st.workspaceName || 'KroomPrint Main',
  cupsURL: st.cupsURL || 'http://localhost:631',
  plan: st.plan || 'KroomPrint Pro',
})

export function AppProvider({ children }) {
  const [printers, setPrinters] = useState([])
  const [jobs, setJobs] = useState([])
  const [history, setHistory] = useState([])
  const [settings, setSettings] = useState(normalizeSettings())
  const [selectedFile, setSelectedFile] = useState(null)
  const [toasts, setToasts] = useState([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [backendInfo, setBackendInfo] = useState(null)

  const toast = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2, 8)
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  // ── Initial load + health ──
  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const health = await api.health()
        if (!cancelled) {
          setBackendInfo(health)
          setConnected(true)
        }
        const [ps, js, hs, st] = await Promise.all([api.listPrinters(), api.listJobs(), api.listHistory(), api.getSettings()])
        if (cancelled) return
        setPrinters(ps)
        setJobs(js)
        setHistory(hs)
        setSettings(normalizeSettings(st))
      } catch (e) {
        if (!cancelled) {
          setConnected(false)
          toast(`Cannot reach backend: ${e.message}`, 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Real-Time SSE Event Streaming (Domain 4) ──
  useEffect(() => {
    const unsub = api.subscribeEvents((event) => {
      if (!event) return
      if (event.type === 'job_created') {
        const j = event.data || event
        if (j?.id) {
          setJobs((list) => {
            const exists = list.some((x) => x.id === j.id)
            if (exists) return list.map((x) => (x.id === j.id ? { ...x, ...j } : x))
            const filtered = list.filter((x) => !x._optimistic)
            return [j, ...filtered]
          })
        }
      } else if (event.type === 'job_updated' || event.type === 'job_completed') {
        const j = event.data || event
        if (j?.id) {
          setJobs((list) => {
            const exists = list.some((x) => x.id === j.id)
            if (exists) return list.map((x) => (x.id === j.id ? { ...x, ...j } : x))
            return [j, ...list.filter((x) => !x._optimistic && x.id !== j.id)]
          })
        }
      } else if (event.type === 'job_deleted') {
        const id = event.data?.id || event.id
        if (id) setJobs((list) => list.filter((x) => x.id !== id))
      }
    })
    return () => unsub()
  }, [])

  // ── Live polling (queue + printer status + history) with adaptive intervals ──
  useEffect(() => {
    let timer
    let active = true
    async function poll() {
      try {
        const [ps, js, hs] = await Promise.all([api.listPrinters(), api.listJobs(), api.listHistory()])
        if (!active) return
        setPrinters((prev) => (JSON.stringify(prev) === JSON.stringify(ps) ? prev : ps))
        setJobs((prev) => {
          const optimistic = prev.filter((x) => x._optimistic)
          if (optimistic.length > 0) {
            const backendIds = new Set(js.map((j) => j.id))
            const pendingOpt = optimistic.filter((o) => !backendIds.has(o.id))
            return [...pendingOpt, ...js]
          }
          return JSON.stringify(prev) === JSON.stringify(js) ? prev : js
        })
        setHistory((prev) => (JSON.stringify(prev) === JSON.stringify(hs) ? prev : hs))
        setConnected(true)

        // If there's an active printing job, poll faster (800ms) for smooth progress
        const isPrinting = js.some((j) => j.status === 'printing' || j.status === 'queued')
        const nextInterval = isPrinting ? 800 : 2500
        timer = setTimeout(poll, nextInterval)
      } catch {
        if (!active) return
        setConnected(false)
        timer = setTimeout(poll, 3000)
      }
    }
    poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [])

  // ── Toast helper (re-export with defaults) ──

  // ── Printer actions ──
  const refreshPrinter = useCallback(async (id) => {
    const p = await api.refreshPrinter(id)
    setPrinters((list) => list.map((x) => (x.id === id ? p : x)))
    toast(`Refreshed ${p.name} status`, 'info')
  }, [toast])

  const refreshAll = useCallback(async () => {
    const ps = await api.listPrinters()
    setPrinters(ps)
    toast('All printer statuses refreshed', 'info')
  }, [toast])

  const addPrinter = useCallback(async (printer) => {
    const created = await api.addPrinter(printer)
    setPrinters((list) => [...list, created])
    toast('Printer added', 'success')
    return created
  }, [toast])

  const removePrinter = useCallback(async (id) => {
    const p = printers.find((x) => x.id === id)
    await api.deletePrinter(id)
    setPrinters((list) => list.filter((x) => x.id !== id))
    toast(`Removed ${p?.name || 'printer'}`, 'info')
  }, [printers, toast])

  const renamePrinter = useCallback(async (id, name) => {
    const p = await api.renamePrinter(id, name)
    setPrinters((list) => list.map((x) => (x.id === id ? p : x)))
    toast('Printer renamed', 'success')
  }, [toast])

  const setDefaultPrinter = useCallback(async (id) => {
    const p = await api.setDefaultPrinter(id)
    setPrinters((list) => list.map((x) => (x.id === id ? p : { ...x, isDefault: false })))
    toast('Default printer updated', 'success')
  }, [toast])

  const togglePrinterEnable = useCallback(async (id) => {
    const p = printers.find((x) => x.id === id)
    const updated = p?.enabled ? await api.disablePrinter(id) : await api.enablePrinter(id)
    setPrinters((list) => list.map((x) => (x.id === id ? updated : x)))
    toast(`${updated.name} ${updated.enabled ? 'enabled' : 'disabled'}`, 'info')
  }, [printers, toast])

  const togglePrinterPause = useCallback(async (id) => {
    const p = printers.find((x) => x.id === id)
    const updated = p?.paused ? await api.resumePrinter(id) : await api.pausePrinter(id)
    setPrinters((list) => list.map((x) => (x.id === id ? updated : x)))
    toast(`${updated.name} ${updated.paused ? 'paused' : 'resumed'}`, 'info')
  }, [printers, toast])

  const testPrint = useCallback(async (id) => {
    const p = printers.find((x) => x.id === id)
    try {
      const res = await api.testPrint(id)
      if (res?.ok) {
        toast(`Ping OK: ${p?.name || 'Printer'} is Online (${res.latencyMs}ms) · ${res.message || 'Ready'}`, 'success')
      } else {
        toast(`Ping failed: ${res?.message || 'Device unreachable'}`, 'error')
      }
      if (res?.status) {
        setPrinters((list) => list.map((x) => (x.id === id ? { ...x, status: res.status } : x)))
      }
    } catch (e) {
      toast(`Ping failed: ${e.message}`, 'error')
    }
  }, [printers, toast])

  const cleanHead = useCallback(async (id) => {
    const p = printers.find((x) => x.id === id)
    try {
      const res = await api.cleanHead(id)
      toast(res?.message || `Proses pembersihan printhead ${p?.name || 'printer'} berhasil dimulai`, 'success')
      return res
    } catch (e) {
      toast(`Gagal menjalankan head cleaning: ${e.message}`, 'error')
      throw e
    }
  }, [printers, toast])

  const nozzleCheck = useCallback(async (id) => {
    const p = printers.find((x) => x.id === id)
    try {
      const res = await api.nozzleCheck(id)
      toast(res?.message || `Pola Nozzle Check untuk ${p?.name || 'printer'} telah ditambahkan ke antrean`, 'success')
      if (res?.job) {
        setJobs((list) => [res.job, ...list])
      }
      return res
    } catch (e) {
      toast(`Gagal membuat Nozzle Check: ${e.message}`, 'error')
      throw e
    }
  }, [printers, toast])

  const getPrinterHealth = useCallback(async (id) => {
    try {
      return await api.getPrinterHealth(id)
    } catch (e) {
      toast(`Gagal mengambil data kesehatan printer: ${e.message}`, 'error')
      throw e
    }
  }, [toast])

  // ── Discovery ──
  const scanForPrinters = useCallback(async () => {
    const res = await api.scan()
    return res.devices || []
  }, [])

  const addDiscovered = useCallback(async (id) => {
    const created = await api.addDiscovered(id)
    setPrinters((list) => [...list, created])
    toast(`Added ${created.name}`, 'success')
    return created
  }, [toast])

  // ── Job actions ──
  const submitJob = useCallback(async (payload, file) => {
    // Add an optimistic placeholder immediately so the queue page shows something at once
    const optimisticId = `opt-${Date.now()}`
    const optimisticJob = {
      id: optimisticId,
      name: file?.name || 'Dokumen',
      fileType: payload.fileType || 'PDF',
      pages: payload.pages || 1,
      copies: payload.copies || 1,
      color: payload.color || false,
      paperSize: payload.paperSize || 'A4',
      status: 'queued',
      progress: 0,
      size: payload.size || '',
      createdAt: new Date().toISOString(),
      printerName: printers.find((p) => p.id === payload.printerId)?.name || '',
      _optimistic: true,
    }
    setJobs((list) => [optimisticJob, ...list])

    try {
      const job = await api.createJob(payload, file)
      // Replace optimistic placeholder and ensure no duplicate entries for job.id
      setJobs((list) => {
        const filtered = list.filter((j) => j.id !== optimisticId && j.id !== job.id)
        return [job, ...filtered]
      })
      const printer = printers.find((p) => p.id === payload.printerId)
      if (job?.status === 'failed') {
        toast(`Gagal mencetak: ${job.error || 'Format dokumen atau printer bermasalah'}`, 'error')
      } else {
        toast(`Job ditambahkan ke antrean ${printer?.name || 'printer'}`, 'success')
      }
      return job
    } catch (e) {
      // Remove the optimistic placeholder on failure
      setJobs((list) => list.filter((j) => j.id !== optimisticId))
      throw e
    }
  }, [printers, toast])

  const cancelJob = useCallback(async (id) => {
    const j = await api.cancelJob(id)
    setJobs((list) => list.map((x) => (x.id === id ? j : x)))
    toast(`Cancelled ${j.name}`, 'info')
  }, [toast])

  const pauseJob = useCallback(async (id) => {
    const j = await api.pauseJob(id)
    setJobs((list) => list.map((x) => (x.id === id ? j : x)))
    toast('Job paused', 'info')
  }, [toast])

  const resumeJob = useCallback(async (id) => {
    const j = await api.resumeJob(id)
    setJobs((list) => list.map((x) => (x.id === id ? j : x)))
    toast('Job resumed', 'info')
  }, [toast])

  const retryJob = useCallback(async (id) => {
    const job = await api.retryJob(id)
    setJobs((list) => [job, ...list])
    toast('Job retried — added to queue', 'success')
  }, [toast])

  const releaseSecureJob = useCallback(async (id, pin) => {
    try {
      const res = await api.releaseSecureJob(id, pin)
      toast(res.message || 'Job released', 'success')
      const js = await api.listJobs()
      setJobs(js)
      return res
    } catch (e) {
      toast(`Gagal melepas dokumen: ${e.message}`, 'error')
      throw e
    }
  }, [toast])

  const rerouteJob = useCallback(async (id, targetPrinterId) => {
    try {
      const res = await api.rerouteJob(id, targetPrinterId)
      toast(res.message || 'Job rerouted', 'success')
      const js = await api.listJobs()
      setJobs(js)
      return res
    } catch (e) {
      toast(`Gagal mengalihkan printer: ${e.message}`, 'error')
      throw e
    }
  }, [toast])

  const purgeJob = useCallback(async (id) => {
    try {
      await api.purgeJob(id)
      setJobs((list) => list.filter((j) => j.id !== id))
      toast('Spool file and job purged', 'info')
    } catch (e) {
      toast(`Gagal menghapus job: ${e.message}`, 'error')
      throw e
    }
  }, [toast])

  const reorderQueue = useCallback(async (dragId, targetId) => {
    setJobs((list) => {
      const drag = list.find((j) => j.id === dragId)
      const target = list.find((j) => j.id === targetId)
      if (!drag || !target) return list
      const next = list.filter((j) => j.id !== dragId)
      const idx = next.findIndex((j) => j.id === targetId)
      next.splice(idx, 0, drag)
      return next
    })
    // persist order
    const ids = jobs.map((j) => j.id)
    if (ids.length) {
      api.reorderJobs(ids).catch(() => {})
    }
    toast('Queue reordered', 'info')
  }, [jobs, toast])

  const setJobPriority = useCallback(async (id, priority) => {
    const j = await api.setJobPriority(id, priority)
    setJobs((list) => list.map((x) => (x.id === id ? j : x)))
  }, [])

  const clearQueue = useCallback(async () => {
    // completed/failed/cancelled jobs are already moved server-side;
    // simply refresh the list
    const js = await api.listJobs()
    setJobs(js)
    toast('Queue refreshed', 'info')
  }, [toast])

  const clearHistory = useCallback(async () => {
    await api.clearHistory()
    setHistory([])
    toast('History cleared', 'info')
  }, [toast])

  // ── Settings & Diagnostics ──
  const updateSettings = useCallback(async (next) => {
    setSettings(next)
    await api.putSettings(next).catch(() => {})
  }, [])

  const runDiagnostics = useCallback(async () => {
    return await api.getDiagnostics()
  }, [])

  const resetAllData = useCallback(async () => {
    const res = await api.resetAllData()
    setJobs([])
    setHistory([])
    setSettings(normalizeSettings())
    toast('Semua antrean cetak, riwayat, dan preferensi telah di-reset', 'success')
    return res
  }, [toast])

  // ── Derived ──
  const defaultPrinter = useMemo(() => printers.find((p) => p.isDefault) || printers[0], [printers])
  const activeCount = useMemo(() => printers.filter((p) => p.status === 'online' && p.enabled).length, [printers])
  const queueCount = useMemo(() => jobs.filter((j) => ['queued', 'printing', 'paused', 'held-secure'].includes(j.status)).length, [jobs])

  const value = useMemo(
    () => ({
      printers, jobs, history, settings, setSettings: updateSettings, selectedFile, setSelectedFile, toasts, toast,
      loading, connected, backendInfo,
      // printers
      refreshPrinter, refreshAll, addPrinter, removePrinter, renamePrinter,
      setDefaultPrinter, togglePrinterEnable, togglePrinterPause, testPrint,
      cleanHead, nozzleCheck, getPrinterHealth,
      // discovery
      scanForPrinters, addDiscovered,
      // jobs
      submitJob, cancelJob, pauseJob, resumeJob, retryJob, releaseSecureJob, rerouteJob, purgeJob, reorderQueue, setJobPriority, clearQueue,
      // history & settings & diagnostics
      clearHistory, updateSettings, runDiagnostics, resetAllData,
      // derived
      defaultPrinter, activeCount, queueCount,
    }),
    [
      printers, jobs, history, settings, selectedFile, toasts, toast, loading, connected, backendInfo,
      refreshPrinter, refreshAll, addPrinter, removePrinter, renamePrinter,
      setDefaultPrinter, togglePrinterEnable, togglePrinterPause, testPrint,
      cleanHead, nozzleCheck, getPrinterHealth,
      scanForPrinters, addDiscovered, submitJob, cancelJob, pauseJob, resumeJob, retryJob,
      releaseSecureJob, rerouteJob, purgeJob, reorderQueue, setJobPriority, clearQueue, clearHistory, updateSettings, runDiagnostics, resetAllData,
      defaultPrinter, activeCount, queueCount,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
