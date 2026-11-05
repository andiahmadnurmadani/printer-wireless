// ─────────────────────────────────────────────
// Alamat server untuk aplikasi Android (Capacitor)
// ─────────────────────────────────────────────

import { Capacitor } from '@capacitor/core'

const SERVER_KEY = 'kroomprint_server_url'

export function isNativeApp() {
  return Capacitor.isNativePlatform()
}

export function getServerUrl() {
  try {
    return localStorage.getItem(SERVER_KEY) || ''
  } catch {
    return ''
  }
}

// normalizeServerUrl menerima "100.90.80.85:8088" atau URL lengkap dan
// mengembalikan origin tanpa garis miring di akhir.
export function normalizeServerUrl(input) {
  let v = (input || '').trim()
  if (!v) return ''
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`
  const u = new URL(v)
  return u.origin
}

export function setServerUrl(url) {
  localStorage.setItem(SERVER_KEY, url)
}

export function clearServerUrl() {
  localStorage.removeItem(SERVER_KEY)
}

// pingServer memastikan alamat yang diisi benar-benar backend KroomPrint.
export async function pingServer(url, timeoutMs = 5000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`Server menjawab ${res.status}`)
    return true
  } finally {
    clearTimeout(timer)
  }
}
